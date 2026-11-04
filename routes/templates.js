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
    const seed = db.transaction(() => {
        const result = db.prepare('INSERT OR IGNORE INTO template_seed_state (user_id) VALUES (?)').run(userId);
        if (result.changes === 0) return;

        const check = db.prepare('SELECT COUNT(*) as count FROM templates WHERE user_id = ?').get(userId);
        if (check && check.count === 0) {
            const insert = db.prepare('INSERT INTO templates (user_id, title, description, quick_replies, feedback_options) VALUES (?, ?, ?, ?, ?)');
            for (const template of defaultTemplates) {
                insert.run(userId, template.title, template.description, template.quick_replies, JSON.stringify([]));
            }
        }
    });

    seed();
}

router.get('/', (req, res) => {
    try {
        seedDefaultTemplates(req.userId);
        const rows = db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY id ASC').all(req.userId);
        const parsed = rows.map(r => ({
            ...r,
            quick_replies: safeJsonParse(r.quick_replies, []),
            feedback_options: safeJsonParse(r.feedback_options, [])
        }));
        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

router.post('/', (req, res) => {
    try {
        const { title, description, quick_replies, feedback_options } = req.body;
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

        const validFeedbackOptions = Array.isArray(feedback_options) ? feedback_options.slice(0, 20).filter(option => typeof option === 'string').map(option => option.trim().slice(0, 200)).filter(Boolean) : [];

        const createTemplate = db.transaction(() => {
            const info = db.prepare('INSERT INTO templates (user_id, title, description, quick_replies) VALUES (?, ?, ?, ?)')
                .run(req.userId, cleanTitle, cleanDesc, JSON.stringify(validReplies), JSON.stringify(validFeedbackOptions));
            db.prepare('INSERT OR IGNORE INTO template_seed_state (user_id) VALUES (?)').run(req.userId);
            return info;
        });
        const info = createTemplate();
        res.json({ id: info.lastInsertRowid, user_id: req.userId, title: cleanTitle, description: cleanDesc, quick_replies: validReplies, feedback_options: validFeedbackOptions });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save template' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        const deleteTemplate = db.transaction(() => {
            const result = db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, req.userId);
            if (result.changes > 0) {
                db.prepare('INSERT OR IGNORE INTO template_seed_state (user_id) VALUES (?)').run(req.userId);
            }
            return result;
        });
        const result = deleteTemplate();
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

module.exports = router;
