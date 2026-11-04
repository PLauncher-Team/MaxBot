const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
    try {
        console.info('[API] GET /api/participants started');
        const rows = db.prepare(`
            SELECT p.*
            FROM participants p
            WHERE p.teacher_id = ?
            ORDER BY p.id DESC
        `).all(req.userId);

        const getGroups = db.prepare(`
            SELECT g.id, g.name
            FROM participant_groups pg
            INNER JOIN groups g ON g.id = pg.group_id
            WHERE pg.participant_id = ? AND g.user_id = ?
            ORDER BY g.name COLLATE NOCASE
        `);

        const result = rows.map(participant => {
            const groups = getGroups.all(participant.id, req.userId);
            return {
                ...participant,
                groups,
                group_ids: groups.map(group => group.id),
                group_names: groups.map(group => group.name),
                group_name: groups[0]?.name || null
            };
        });
        console.info('[API] GET /api/participants completed:', result.length);
        res.json(result);
    } catch (e) {
        console.error('Failed to fetch participants:', e);
        res.status(500).json({ error: 'Failed to fetch participants' });
    }
});

router.delete('/:id/groups/:groupId', (req, res) => {
    try {
        const participantId = Number(req.params.id);
        const groupId = Number(req.params.groupId);
        if (!Number.isSafeInteger(participantId) || participantId <= 0 ||
            !Number.isSafeInteger(groupId) || groupId <= 0) {
            return res.status(400).json({ error: 'Invalid participant or group id' });
        }

        const participant = db.prepare(`
            SELECT p.id
            FROM participants p
            INNER JOIN groups g ON g.id = ?
            WHERE p.id = ? AND p.teacher_id = ? AND g.user_id = ?
        `).get(groupId, participantId, req.userId, req.userId);
        if (!participant) return res.status(404).json({ error: 'Participant or group not found' });

        const removeMembership = db.transaction(() => {
            const result = db.prepare(`
                DELETE FROM participant_groups
                WHERE participant_id = ? AND group_id = ?
            `).run(participantId, groupId);

            db.prepare(`
                UPDATE participants
                SET group_id = (
                    SELECT group_id FROM participant_groups
                    WHERE participant_id = ?
                    ORDER BY group_id LIMIT 1
                )
                WHERE id = ? AND teacher_id = ?
            `).run(participantId, participantId, req.userId);

            return result.changes;
        });

        const removed = removeMembership();
        res.json({ success: true, removed });
    } catch (e) {
        console.error('Failed to remove participant from group:', e);
        res.status(500).json({ error: 'Failed to remove participant from group' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const removeParticipant = db.transaction(() => {
            const participant = db.prepare('SELECT id FROM participants WHERE id = ? AND teacher_id = ?')
                .get(id, req.userId);
            if (!participant) return false;

            db.prepare('DELETE FROM participant_groups WHERE participant_id = ?').run(id);
            db.prepare('DELETE FROM participants WHERE id = ? AND teacher_id = ?').run(id, req.userId);
            return true;
        });

        const removed = removeParticipant();
        if (!removed) {
            return res.status(404).json({ error: 'Participant not found' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('Failed to delete participant:', e);
        res.status(500).json({ error: 'Failed to delete participant' });
    }
});

router.post('/batch-group', (req, res) => {
    try {
        const { participant_ids, group_ids, group_id } = req.body;
        if (!Array.isArray(participant_ids) || participant_ids.length === 0) {
            return res.status(400).json({ error: 'Participant IDs required' });
        }

        const rawGroupIds = Array.isArray(group_ids)
            ? group_ids
            : (group_id !== undefined && group_id !== null && group_id !== '' ? [group_id] : []);
        if (rawGroupIds.length === 0) {
            return res.status(400).json({ error: 'At least one group is required' });
        }

        const participantIds = [...new Set(participant_ids.map(Number))];
        const groupIds = [...new Set(rawGroupIds.map(Number))];
        if (participantIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
            groupIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
            return res.status(400).json({ error: 'Invalid participant or group id' });
        }

        const groupPlaceholders = groupIds.map(() => '?').join(',');
        const validGroups = db.prepare(`
            SELECT id FROM groups WHERE user_id = ? AND id IN (${groupPlaceholders})
        `).all(req.userId, ...groupIds);
        if (validGroups.length !== groupIds.length) {
            return res.status(400).json({ error: 'One or more groups were not found' });
        }

        const participantPlaceholders = participantIds.map(() => '?').join(',');
        const validParticipants = db.prepare(`
            SELECT id FROM participants WHERE teacher_id = ? AND id IN (${participantPlaceholders})
        `).all(req.userId, ...participantIds);
        if (validParticipants.length !== participantIds.length) {
            return res.status(400).json({ error: 'One or more participants were not found' });
        }

        const addMemberships = db.transaction(() => {
            const insert = db.prepare(`
                INSERT OR IGNORE INTO participant_groups (participant_id, group_id)
                VALUES (?, ?)
            `);
            let added = 0;
            for (const participantId of participantIds) {
                for (const groupId of groupIds) {
                    added += insert.run(participantId, groupId).changes;
                }
                db.prepare(`
                    UPDATE participants SET group_id = COALESCE(group_id, ?)
                    WHERE id = ? AND teacher_id = ?
                `).run(groupIds[0], participantId, req.userId);
            }
            return added;
        });

        const added = addMemberships();
        res.json({ success: true, memberships_added: added });
    } catch (e) {
        console.error('Failed to add participants to groups:', e);
        res.status(500).json({ error: 'Failed to add participants to groups' });
    }
});

module.exports = router;
