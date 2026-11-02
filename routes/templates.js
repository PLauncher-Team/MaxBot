const express = require('express');
const db = require('../db');

const router = express.Router();

function safeJsonParse(data, fallback = []) {
    if (!data || typeof data !== 'string') return fallback;
    try {
        return JSON.parse(data);
    } catch (e) {
        return fallback;
    }
}

const defaultTemplates = [
    {
        title: 'Для соревнования',
        description: 'Соревнование по [дисциплина].\nЗаявки принимаются с [дата/время] до [дата/время].\nПроводится с [дата/время] до [дата/время].',
        quick_replies: JSON.stringify([
            { question: 'Где?', answer: 'В спортивном комплексе школы' },
            { question: 'Когда?', answer: 'В субботу в 10:00' }
        ])
    },
    {
        title: 'Для справки об отсутствии',
        description: 'Уважаемые родители, напоминаем о необходимости предоставить медицинскую справку или заявление об отсутствии ученика с указанием периода и причины.',
        quick_replies: JSON.stringify([
            { question: 'Какую именно справку надо?', answer: 'Справка от врача-педиатра с допуском к занятиям' },
            { question: 'Куда приносить?', answer: 'Классному руководителю или медпункт' }
        ])
    }
];

function seedDefaultTemplates(userId) {
    try {
        const check = db.prepare('SELECT COUNT(*) as count FROM templates WHERE user_id = ?').get(userId);
        if (check && check.count === 0) {
            const insert = db.prepare('INSERT INTO templates (user_id, title, description, quick_replies) VALUES (?, ?, ?, ?)');
            for (const t of defaultTemplates) {
                insert.run(userId, t.title, t.description, t.quick_replies);
            }
        }
    } catch (e) {}
}

router.get('/', (req, res) => {
    try {
        seedDefaultTemplates(req.userId);
        const rows = db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY id ASC').all(req.userId);
        const parsed = rows.map(r => ({
            ...r,
            quick_replies: safeJsonParse(r.quick_replies, [])
        }));
        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

router.post('/', (req, res) => {
    try {
        const { title, description, quick_replies } = req.body;
        if (!title || !description || typeof title !== 'string' || typeof description !== 'string') {
            return res.status(400).json({ error: 'Title and description required' });
        }
        const cleanTitle = title.trim().slice(0, 150);
        const cleanDesc = description.trim().slice(0, 2000);
        if (cleanTitle.length === 0 || cleanDesc.length === 0) {
            return res.status(400).json({ error: 'Title and description cannot be empty' });
        }

        const validReplies = Array.isArray(quick_replies) ? quick_replies.slice(0, 20).map(r => ({
            question: String(r.question || '').trim().slice(0, 150),
            answer: String(r.answer || '').trim().slice(0, 500)
        })).filter(r => r.question.length > 0) : [];

        const stmt = db.prepare('INSERT INTO templates (user_id, title, description, quick_replies) VALUES (?, ?, ?, ?)');
        const info = stmt.run(req.userId, cleanTitle, cleanDesc, JSON.stringify(validReplies));
        res.json({ id: info.lastInsertRowid, user_id: req.userId, title: cleanTitle, description: cleanDesc, quick_replies: validReplies });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save template' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, req.userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

module.exports = router;
