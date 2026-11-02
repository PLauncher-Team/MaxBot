const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

function generateUniqueGroupId() {
    return 'g_' + crypto.randomBytes(6).toString('hex');
}

router.get('/', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT g.*, COUNT(p.id) as participant_count
            FROM groups g
            LEFT JOIN participants p ON p.group_id = g.id
            WHERE g.user_id = ?
            GROUP BY g.id
            ORDER BY g.id DESC
        `).all(req.userId);
        res.json(rows);
    } catch (e) {
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
        res.status(500).json({ error: 'Failed to create group' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        db.prepare('DELETE FROM groups WHERE id = ? AND user_id = ?').run(id, req.userId);
        db.prepare('UPDATE participants SET group_id = NULL WHERE teacher_id = ? AND group_id = ?').run(req.userId, id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete group' });
    }
});

module.exports = router;
