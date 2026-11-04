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

router.get('/', (req, res) => {
    try {
        db.prepare("DELETE FROM templates WHERE user_id = ? AND ((title = ? AND description = ?) OR (title = ? AND description = ?))").run(
            req.userId,
            'Для соревнования',
            'Соревнование по [дисциплина].\nЗаявки принимаются с [дата/время] до [дата/время].\nПроводится с [дата/время] до [дата/время].',
            'Для справки об отсутствии',
            'Уважаемые родители, напоминаем о необходимости предоставить медицинскую справку или заявление об отсутствии ученика с указанием периода и причины.'
        );
        const rows = db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY id ASC').all(req.userId);
        const parsed = rows.map(row => ({
            ...row,
            quick_replies: safeJsonParse(row.quick_replies, []),
            feedback_options: safeJsonParse(row.feedback_options, [])
        }));
        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

router.post('/', (req, res) => {
    try {
        const { title, description, quick_replies, feedback_options, feedback_enabled, feedback_allow_files } = req.body;
        if (!title || !description || typeof title !== 'string' || typeof description !== 'string') {
            return res.status(400).json({ error: 'Title and description required' });
        }
        const cleanTitle = title.trim().slice(0, 150);
        const cleanDesc = description.trim().slice(0, 2000);
        if (cleanTitle.length === 0 || cleanDesc.length === 0) {
            return res.status(400).json({ error: 'Title and description cannot be empty' });
        }
        const validReplies = Array.isArray(quick_replies) ? quick_replies.slice(0, 20).map(reply => ({
            question: String(reply.question || '').trim().slice(0, 150),
            answer: String(reply.answer || '').trim().slice(0, 500)
        })).filter(reply => reply.question.length > 0) : [];
        const feedbackEnabled = feedback_enabled === true;
        const feedbackAllowFiles = feedbackEnabled && feedback_allow_files === true;
        const validFeedbackOptions = feedbackEnabled && Array.isArray(feedback_options)
            ? feedback_options.slice(0, 20).filter(option => typeof option === 'string').map(option => option.trim().slice(0, 200)).filter(Boolean)
            : [];
        const info = db.prepare('INSERT INTO templates (user_id, title, description, quick_replies, feedback_options, feedback_enabled, feedback_allow_files) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(req.userId, cleanTitle, cleanDesc, JSON.stringify(validReplies), JSON.stringify(validFeedbackOptions), feedbackEnabled ? 1 : 0, feedbackAllowFiles ? 1 : 0);
        res.json({
            id: info.lastInsertRowid,
            user_id: req.userId,
            title: cleanTitle,
            description: cleanDesc,
            quick_replies: validReplies,
            feedback_options: validFeedbackOptions,
            feedback_enabled: feedbackEnabled,
            feedback_allow_files: feedbackAllowFiles
        });
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
        const result = db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, req.userId);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

module.exports = router;
