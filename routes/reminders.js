const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { sendBroadcastMessage } = require('../bot');
const { getMoscowDateTimeString, calculateNextScheduledTime } = require('../scheduler');

const router = express.Router();

function safeJsonParse(data, fallback = []) {
    if (!data || typeof data !== 'string') return fallback;
    try {
        return JSON.parse(data);
    } catch (e) {
        return fallback;
    }
}


function getTargetChatIds(userId, validRecipients) {
    const targetChatIds = [];

    if (validRecipients.includes('Себе')) {
        targetChatIds.push(String(userId));
    }

    const groupNames = validRecipients.filter(name => name !== 'Себе');
    if (groupNames.length > 0) {
        const placeholders = groupNames.map(() => '?').join(',');
        const query = `
            SELECT DISTINCT p.chat_id
            FROM participants p
            JOIN groups g ON p.group_id = g.id
            WHERE g.user_id = ? AND g.name IN (${placeholders})
        `;
        const rows = db.prepare(query).all(userId, ...groupNames);
        rows.forEach(row => {
            const chatId = String(row.chat_id);
            if (!targetChatIds.includes(chatId)) targetChatIds.push(chatId);
        });
    }

    return targetChatIds;
}

async function sendImmediateReminder(reminderId, userId, recipients, text, quickReplies, images, repeatType, repeatTime) {
    const targetChatIds = getTargetChatIds(userId, recipients);
    const sendResult = await sendBroadcastMessage(reminderId, targetChatIds, text, quickReplies, images);

    if (repeatType && repeatType !== 'Никогда') {
        const now = getMoscowDateTimeString();
        const failedChatIds = Array.isArray(sendResult?.failedChatIds) ? sendResult.failedChatIds : [];
        const nextTime = failedChatIds.length > 0
            ? now
            : calculateNextScheduledTime(now, repeatType, repeatTime, now);

        db.prepare(`
            UPDATE reminders
            SET status = 'scheduled', scheduled_time = ?, pending_recipients = ?
            WHERE id = ? AND user_id = ?
        `).run(
            nextTime || now,
            failedChatIds.length > 0 ? JSON.stringify(failedChatIds) : null,
            reminderId,
            userId
        );
    }
}

router.get('/', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY id DESC').all(req.userId);
        const parsed = rows.map(r => ({
            ...r,
            recipients: safeJsonParse(r.recipients, []),
            quick_replies: safeJsonParse(r.quick_replies, []),
            images: safeJsonParse(r.images, [])
        }));
        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch reminders' });
    }
});

router.post('/upload-media', (req, res) => {
    try {
        const { media_data } = req.body;
        if (!media_data || typeof media_data !== 'string') {
            return res.status(400).json({ error: 'Media data required' });
        }

        const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const matches = media_data.match(/^data:(image|video)\/([a-zA-Z0-9]+);base64,(.+)$/);
        let ext = 'png';
        let isVideo = false;
        let buffer;

        if (matches) {
            isVideo = matches[1] === 'video';
            ext = matches[2] === 'jpeg' ? 'jpg' : matches[2];
            buffer = Buffer.from(matches[3], 'base64');
        } else {
            buffer = Buffer.from(media_data, 'base64');
        }

        if (buffer.length > 50 * 1024 * 1024) {
            return res.status(400).json({ error: 'File size exceeds 50MB limit' });
        }

        const prefix = isVideo ? 'vid_' : 'img_';
        const filename = prefix + crypto.randomBytes(8).toString('hex') + '.' + ext;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, buffer);

        const host = req.headers['host'] || 'mymaxapp.duckdns.org';
        const fullUrl = `https://${host}/api/uploads/${filename}`;

        res.json({ url: fullUrl, type: isVideo ? 'video' : 'image', filename });
    } catch (e) {
        res.status(500).json({ error: 'Failed to upload media' });
    }
});

router.post('/upload-image', (req, res) => {
    try {
        const { image_data } = req.body;
        if (!image_data || typeof image_data !== 'string') {
            return res.status(400).json({ error: 'Image data required' });
        }

        const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const matches = image_data.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        let ext = 'png';
        let buffer;
        if (matches) {
            ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            buffer = Buffer.from(matches[2], 'base64');
        } else {
            buffer = Buffer.from(image_data, 'base64');
        }

        if (buffer.length > 50 * 1024 * 1024) {
            return res.status(400).json({ error: 'Image size exceeds 50MB limit' });
        }

        const filename = 'img_' + crypto.randomBytes(8).toString('hex') + '.' + ext;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, buffer);

        const host = req.headers['host'] || 'mymaxapp.duckdns.org';
        const fullUrl = `https://${host}/api/uploads/${filename}`;

        res.json({ url: fullUrl, type: 'image', filename });
    } catch (e) {
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, req.userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete reminder' });
    }
});

router.post('/', async (req, res) => {
    try {
        const {
            title,
            description,
            send_now,
            scheduled_time,
            repeat_type,
            repeat_time,
            recipients,
            quick_replies,
            images
        } = req.body;

        if (!title || typeof title !== 'string') {
            return res.status(400).json({ error: 'Title required' });
        }

        const cleanTitle = title.trim().slice(0, 150);
        if (cleanTitle.length === 0) {
            return res.status(400).json({ error: 'Title cannot be empty' });
        }

        const cleanDesc = typeof description === 'string' ? description.trim().slice(0, 2000) : '';
        const validRepeatTypes = ['Никогда', 'Каждую минуту', 'Каждый день', 'Каждую неделю', 'Каждый месяц'];
        const cleanRepeatType = validRepeatTypes.includes(repeat_type) ? repeat_type : 'Никогда';
        const cleanRepeatTime = typeof repeat_time === 'string' ? repeat_time.slice(0, 10) : null;
        const cleanScheduledTime = send_now && cleanRepeatType !== 'Никогда' ? getMoscowDateTimeString() : (typeof scheduled_time === 'string' ? scheduled_time.slice(0, 30) : null);
        const status = send_now && cleanRepeatType === 'Никогда' ? 'sent' : 'scheduled';

        const validRecipients = Array.isArray(recipients) ? recipients.slice(0, 50).map(r => String(r).trim().slice(0, 100)).filter(r => r.length > 0) : [];
        if (validRecipients.length === 0) {
            return res.status(400).json({ error: 'At least one recipient required' });
        }

        const validReplies = Array.isArray(quick_replies) ? quick_replies.slice(0, 20).map(r => ({
            question: String(r.question || '').trim().slice(0, 150),
            answer: String(r.answer || '').trim().slice(0, 500)
        })).filter(r => r.question.length > 0) : [];

        const validImages = Array.isArray(images) ? images.slice(0, 11) : [];

        const stmt = db.prepare(`
            INSERT INTO reminders (
                user_id, title, description, send_now, scheduled_time, repeat_type, repeat_time, recipients, quick_replies, images, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = stmt.run(
            req.userId,
            cleanTitle,
            cleanDesc,
            send_now ? 1 : 0,
            cleanScheduledTime,
            cleanRepeatType,
            cleanRepeatTime,
            JSON.stringify(validRecipients),
            JSON.stringify(validReplies),
            JSON.stringify(validImages),
            status
        );

        if (send_now) {
            const fullText = cleanTitle + (cleanDesc ? '\n\n' + cleanDesc : '');
            await sendImmediateReminder(
                info.lastInsertRowid,
                req.userId,
                validRecipients,
                fullText,
                validReplies,
                validImages,
                cleanRepeatType,
                cleanRepeatTime
            );
        }
        res.json({ id: info.lastInsertRowid, status });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save reminder' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const existing = db.prepare('SELECT id FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
        if (!existing) {
            return res.status(404).json({ error: 'Reminder not found' });
        }

        const {
            title,
            description,
            send_now,
            scheduled_time,
            repeat_type,
            repeat_time,
            recipients,
            quick_replies,
            images
        } = req.body;

        if (!title || typeof title !== 'string') {
            return res.status(400).json({ error: 'Title required' });
        }

        const cleanTitle = title.trim().slice(0, 150);
        if (cleanTitle.length === 0) {
            return res.status(400).json({ error: 'Title cannot be empty' });
        }

        const cleanDesc = typeof description === 'string' ? description.trim().slice(0, 2000) : '';
        const validRepeatTypes = ['Никогда', 'Каждую минуту', 'Каждый день', 'Каждую неделю', 'Каждый месяц'];
        const cleanRepeatType = validRepeatTypes.includes(repeat_type) ? repeat_type : 'Никогда';
        const cleanRepeatTime = typeof repeat_time === 'string' ? repeat_time.slice(0, 10) : null;
        const cleanScheduledTime = send_now && cleanRepeatType !== 'Никогда' ? getMoscowDateTimeString() : (typeof scheduled_time === 'string' ? scheduled_time.slice(0, 30) : null);
        const status = send_now && cleanRepeatType === 'Никогда' ? 'sent' : 'scheduled';

        const validRecipients = Array.isArray(recipients) ? recipients.slice(0, 50).map(r => String(r).trim().slice(0, 100)).filter(r => r.length > 0) : [];
        if (validRecipients.length === 0) {
            return res.status(400).json({ error: 'At least one recipient required' });
        }

        const validReplies = Array.isArray(quick_replies) ? quick_replies.slice(0, 20).map(r => ({
            question: String(r.question || '').trim().slice(0, 150),
            answer: String(r.answer || '').trim().slice(0, 500)
        })).filter(r => r.question.length > 0) : [];

        const validImages = Array.isArray(images) ? images.slice(0, 11) : [];

        const stmt = db.prepare(`
            UPDATE reminders
            SET title = ?, description = ?, send_now = ?, scheduled_time = ?, repeat_type = ?, repeat_time = ?, recipients = ?, quick_replies = ?, images = ?, status = ?, pending_recipients = NULL
            WHERE id = ? AND user_id = ?
        `);

        stmt.run(
            cleanTitle,
            cleanDesc,
            send_now ? 1 : 0,
            cleanScheduledTime,
            cleanRepeatType,
            cleanRepeatTime,
            JSON.stringify(validRecipients),
            JSON.stringify(validReplies),
            JSON.stringify(validImages),
            status,
            id,
            req.userId
        );

        if (send_now) {
            const fullText = cleanTitle + (cleanDesc ? '\n\n' + cleanDesc : '');
            await sendImmediateReminder(
                id,
                req.userId,
                validRecipients,
                fullText,
                validReplies,
                validImages,
                cleanRepeatType,
                cleanRepeatTime
            );
        }
        res.json({ id, status });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update reminder' });
    }
});

module.exports = router;
