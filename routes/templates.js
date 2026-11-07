const express = require('express');
const db = require('../db');

const router = express.Router();

const defaultTemplates = [
    {
        title: 'Справка об отсутствии',
        description: 'Ваш ребёнок отсутствовал на занятиях. Для подтверждения причины отсутствия необходимо предоставить справку.\n\nПожалуйста, прикрепите медицинскую справку или другой документ, подтверждающий причину отсутствия ребёнка.\n\nВ документе должны быть указаны ФИО ребёнка и период отсутствия.\n\nСпасибо за понимание!',
        feedback_options: [],
        feedback_enabled: 1,
        feedback_allow_files: 1
    },
    {
        title: 'Соревнование [Название]',
        description: 'Соревнование по [дисциплина].\n\nПриём заявок: с [дата начала] до [дата окончания].\n\nМесто проведения: [адрес / город / спортивный объект].\n\nСайт соревнования: [ссылка]\n\nЕсли планируете принять участие, выберите соответствующий вариант ответа.\n\nДля подачи заявки прикрепите заполненную форму и необходимые документы.\n\nОбратите внимание на сроки приёма заявок!',
        feedback_options: ['Планирую участвовать.', 'Не планирую участвовать.', 'Нужна дополнительная информация.'],
        feedback_enabled: 1,
        feedback_allow_files: 1
    },
    {
        title: 'Родительское собрание [Тема]',
        description: 'Приглашаем вас на родительское собрание.\n\nДата: [дата]\nВремя: [время]\nМесто проведения: [адрес / кабинет]\n\nПовестка собрания:\n[Основные вопросы для обсуждения]\n\nПожалуйста, выберите вариант ответа, чтобы мы могли заранее определить количество участников.\n\nБудем рады вас видеть!',
        feedback_options: ['Смогу прийти.', 'Не смогу прийти.'],
        feedback_enabled: 1,
        feedback_allow_files: 0
    }
];

function safeJsonParse(data, fallback = []) {
    if (!data || typeof data !== 'string') return fallback;
    try {
        return JSON.parse(data);
    } catch (e) {
        return fallback;
    }
}

function initializeDefaultTemplates(userId) {
    const initialize = db.transaction(() => {
        const initialized = db.prepare('SELECT user_id FROM template_seed_state WHERE user_id = ?').get(userId);
        if (initialized) return;

        const existingData = db.prepare('SELECT 1 FROM templates WHERE user_id = ? LIMIT 1').get(userId)
            || db.prepare('SELECT 1 FROM reminders WHERE user_id = ? LIMIT 1').get(userId)
            || db.prepare('SELECT 1 FROM groups WHERE user_id = ? LIMIT 1').get(userId)
            || db.prepare('SELECT 1 FROM participants WHERE teacher_id = ? LIMIT 1').get(userId);

        if (!existingData) {
            const insert = db.prepare('INSERT INTO templates (user_id, title, description, quick_replies, feedback_options, feedback_enabled, feedback_allow_files) VALUES (?, ?, ?, ?, ?, ?, ?)');
            defaultTemplates.forEach(template => {
                insert.run(
                    userId,
                    template.title,
                    template.description,
                    JSON.stringify([]),
                    JSON.stringify(template.feedback_options),
                    template.feedback_enabled,
                    template.feedback_allow_files
                );
            });
        }

        db.prepare('INSERT OR IGNORE INTO template_seed_state (user_id) VALUES (?)').run(userId);
    });
    initialize.immediate();
}

function normalizeTemplate(payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    if (typeof body.title !== 'string' || typeof body.description !== 'string') return null;

    const title = body.title.trim().slice(0, 150);
    const description = body.description.trim().slice(0, 2000);
    if (!title || !description) return null;

    const quickReplies = Array.isArray(body.quick_replies) ? body.quick_replies.slice(0, 20).map(reply => ({
        question: String(reply?.question || '').trim().slice(0, 150),
        answer: String(reply?.answer || '').trim().slice(0, 500)
    })).filter(reply => reply.question.length > 0) : [];
    const feedbackEnabled = body.feedback_enabled === true;
    const feedbackAllowFiles = feedbackEnabled && body.feedback_allow_files === true;
    const feedbackOptions = feedbackEnabled && Array.isArray(body.feedback_options)
        ? body.feedback_options.slice(0, 20).filter(option => typeof option === 'string').map(option => option.trim().slice(0, 200)).filter(Boolean)
        : [];

    return {
        title,
        description,
        quick_replies: quickReplies,
        feedback_options: feedbackOptions,
        feedback_enabled: feedbackEnabled,
        feedback_allow_files: feedbackAllowFiles
    };
}

router.get('/', (req, res) => {
    try {
        initializeDefaultTemplates(req.userId);
        const rows = db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY id ASC').all(req.userId);
        const parsed = rows.map(row => ({
            ...row,
            quick_replies: safeJsonParse(row.quick_replies, []),
            feedback_options: safeJsonParse(row.feedback_options, []),
            feedback_enabled: Boolean(row.feedback_enabled),
            feedback_allow_files: Boolean(row.feedback_allow_files)
        }));
        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

router.post('/', (req, res) => {
    try {
        const template = normalizeTemplate(req.body);
        if (!template) return res.status(400).json({ error: 'Title and description required' });

        const info = db.prepare('INSERT INTO templates (user_id, title, description, quick_replies, feedback_options, feedback_enabled, feedback_allow_files) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(
                req.userId,
                template.title,
                template.description,
                JSON.stringify(template.quick_replies),
                JSON.stringify(template.feedback_options),
                template.feedback_enabled ? 1 : 0,
                template.feedback_allow_files ? 1 : 0
            );
        res.json({
            id: info.lastInsertRowid,
            user_id: req.userId,
            ...template
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save template' });
    }
});

router.put('/:id', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

        const existing = db.prepare('SELECT id FROM templates WHERE id = ? AND user_id = ?').get(id, req.userId);
        if (!existing) return res.status(404).json({ error: 'Template not found' });

        const template = normalizeTemplate(req.body);
        if (!template) return res.status(400).json({ error: 'Title and description required' });

        db.prepare('UPDATE templates SET title = ?, description = ?, quick_replies = ?, feedback_options = ?, feedback_enabled = ?, feedback_allow_files = ? WHERE id = ? AND user_id = ?')
            .run(
                template.title,
                template.description,
                JSON.stringify(template.quick_replies),
                JSON.stringify(template.feedback_options),
                template.feedback_enabled ? 1 : 0,
                template.feedback_allow_files ? 1 : 0,
                id,
                req.userId
            );
        res.json({
            id,
            user_id: req.userId,
            ...template
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update template' });
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
