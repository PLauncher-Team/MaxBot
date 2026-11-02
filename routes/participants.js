const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT p.*, g.name as group_name
            FROM participants p
            LEFT JOIN groups g ON p.group_id = g.id
            WHERE p.teacher_id = ?
            ORDER BY p.id DESC
        `).all(req.userId);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch participants' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        db.prepare('DELETE FROM participants WHERE id = ? AND teacher_id = ?').run(id, req.userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete participant' });
    }
});

router.post('/batch-group', (req, res) => {
    try {
        const { participant_ids, group_id } = req.body;
        if (!Array.isArray(participant_ids) || participant_ids.length === 0) {
            return res.status(400).json({ error: 'Participant IDs required' });
        }
        const groupId = group_id !== undefined && group_id !== null && group_id !== '' ? parseInt(group_id, 10) : null;
        if (groupId) {
            const validGroup = db.prepare('SELECT id FROM groups WHERE id = ? AND user_id = ?').get(groupId, req.userId);
            if (!validGroup) {
                return res.status(400).json({ error: 'Group not found' });
            }
        }

        const stmt = db.prepare('UPDATE participants SET group_id = ? WHERE id = ? AND teacher_id = ?');
        for (const pid of participant_ids) {
            stmt.run(groupId, parseInt(pid, 10), req.userId);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update participants group' });
    }
});

module.exports = router;
