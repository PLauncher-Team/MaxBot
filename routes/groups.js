const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

function generateUniqueGroupId() {
    return 'g_' + crypto.randomBytes(6).toString('hex');
}

router.get('/', (req, res) => {
    try {
        console.info('[API] GET /api/groups started');
        const rows = db.prepare(`
            SELECT g.*, COUNT(DISTINCT pg.participant_id) as participant_count
            FROM groups g
            LEFT JOIN participant_groups pg ON pg.group_id = g.id
            WHERE g.user_id = ?
            GROUP BY g.id
            ORDER BY g.id DESC
        `).all(req.userId);
        console.info('[API] GET /api/groups completed:', rows.length);
        res.json(rows);
    } catch (e) {
        console.error('Failed to fetch groups:', e);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

router.post('/', (req, res) => {
    try {
        const { name } = req.body;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Name is required' });
        }
        const cleanName = name.trim().slice(0, 100);
        if (cleanName.length === 0) {
            return res.status(400).json({ error: 'Name cannot be empty' });
        }

        const uniqueId = generateUniqueGroupId();
        const stmt = db.prepare('INSERT INTO groups (user_id, name, unique_id) VALUES (?, ?, ?)');
        const info = stmt.run(req.userId, cleanName, uniqueId);
        res.json({ id: info.lastInsertRowid, user_id: req.userId, name: cleanName, unique_id: uniqueId, participant_count: 0 });
    } catch (e) {
        console.error('Failed to create group:', e);
        res.status(500).json({ error: 'Failed to create group' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const deleteGroup = db.transaction(() => {
            const group = db.prepare('SELECT id FROM groups WHERE id = ? AND user_id = ?').get(id, req.userId);
            if (!group) return null;

            const removed = db.prepare('DELETE FROM participant_groups WHERE group_id = ?').run(id);
            db.prepare(`
                UPDATE participants
                SET group_id = (
                    SELECT group_id FROM participant_groups
                    WHERE participant_id = participants.id
                    ORDER BY group_id LIMIT 1
                )
                WHERE teacher_id = ? AND group_id = ?
            `).run(req.userId, id);
            db.prepare('DELETE FROM groups WHERE id = ? AND user_id = ?').run(id, req.userId);

            return { removed_memberships: removed.changes };
        });

        const result = deleteGroup();
        if (!result) return res.status(404).json({ error: 'Group not found' });
        res.json({ success: true, ...result });
    } catch (e) {
        console.error('Failed to delete group:', e);
        res.status(500).json({ error: 'Failed to delete group' });
    }
});

module.exports = router;
