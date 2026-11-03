const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { sendBroadcastMessage, deleteMaxMessage, deleteLinkedReplyMessages, editMaxMessage } = require('../bot');
const { BOT_TOKEN } = require('../auth');
const { getMoscowDateTimeString, calculateNextScheduledTime } = require('../scheduler');

const router = express.Router();

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://mymaxapp.duckdns.org').replace(/\/+$/, '');
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 7680;
const MEDIA_TYPES = {
    'image/png': { kind: 'image', ext: 'png' },
    'image/jpeg': { kind: 'image', ext: 'jpg' },
    'image/gif': { kind: 'image', ext: 'gif' },
    'image/webp': { kind: 'image', ext: 'webp' },
    'video/mp4': { kind: 'video', ext: 'mp4' },
    'video/quicktime': { kind: 'video', ext: 'mov' },
    'video/webm': { kind: 'video', ext: 'webm' }
};
const FILE_TYPES = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    rtf: 'application/rtf',
    md: 'text/markdown',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odp: 'application/vnd.oasis.opendocument.presentation',
    zip: 'application/zip'
};

function cleanUploadedFileName(name, extension) {
    const clean = path.basename(String(name || '').replace(/\\/g, '/'))
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 120);
    return clean || 'Файл.' + extension;
}

function getImageDimensions(buffer, mimeType) {
    if (mimeType === 'image/png' && buffer.length >= 24) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === 'image/gif' && buffer.length >= 10) {
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mimeType === 'image/webp' && buffer.length >= 30) {
        const format = buffer.toString('ascii', 12, 16);
        if (format === 'VP8X') return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
        if (format === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
            return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
        }
        if (format === 'VP8L' && buffer[20] === 0x2f) {
            const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
            return {
                width: 1 + (((b2 & 0x3f) << 8) | b1),
                height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
            };
        }
        return null;
    }
    if (mimeType === 'image/jpeg' && buffer.length >= 4) {
        let offset = 2;
        while (offset + 4 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset++;
                continue;
            }
            let marker = buffer[offset + 1];
            offset += 2;
            while (marker === 0xff && offset < buffer.length) marker = buffer[offset++];
            if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            if (offset + 2 > buffer.length) return null;
            const segmentLength = buffer.readUInt16BE(offset);
            if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                if (segmentLength < 7) return null;
                return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
            }
            offset += segmentLength;
        }
    }
    return null;
}

function hasValidMediaSignature(buffer, mimeType) {
    if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (mimeType === 'image/gif') return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
    if (mimeType === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    return false;
}

function hasValidFileSignature(buffer, extension) {
    if (extension === 'pdf') return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (['doc', 'xls', 'ppt'].includes(extension)) return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'zip'].includes(extension)) {
        return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3]);
    }
    if (extension === 'rtf') return buffer.subarray(0, 5).toString('ascii').toLowerCase() === '{\\rtf';
    if (['txt', 'csv', 'md'].includes(extension)) return !buffer.includes(0);
    return false;
}

function decodeUploadedMedia(data, expectedKind = 'image', originalName = '') {
    if (typeof data !== 'string' || data.length === 0) throw new Error('INVALID_UPLOAD');
    const match = /^data:([^;,]+);base64,([a-z0-9+/]+={0,2})$/i.exec(data);
    if (!match) throw new Error('INVALID_UPLOAD');
    const declaredMimeType = match[1].toLowerCase();
    const encoded = match[2];
    if (encoded.length % 4 !== 0) throw new Error('INVALID_UPLOAD');
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.length === 0 || buffer.toString('base64') !== encoded) throw new Error('INVALID_UPLOAD');
    if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('FILE_TOO_LARGE');

    if (expectedKind === 'image') {
        const mediaType = MEDIA_TYPES[declaredMimeType];
        if (!mediaType || mediaType.kind !== 'image' || !hasValidMediaSignature(buffer, declaredMimeType)) throw new Error('INVALID_IMAGE');
        const dimensions = getImageDimensions(buffer, declaredMimeType);
        if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new Error('INVALID_IMAGE');
        if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) throw new Error('IMAGE_TOO_LARGE');
        return {
            buffer,
            kind: 'image',
            ext: mediaType.ext,
            mimeType: declaredMimeType,
            name: cleanUploadedFileName(originalName, mediaType.ext),
            dimensions
        };
    }

    const extension = path.extname(String(originalName || '')).slice(1).toLowerCase();
    const mimeType = FILE_TYPES[extension];
    if (!mimeType || !hasValidFileSignature(buffer, extension)) throw new Error('INVALID_FILE');
    return { buffer, kind: 'file', ext: extension, mimeType, name: cleanUploadedFileName(originalName, extension) };
}

function storeUploadedMedia(media, userId) {
    const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const prefix = media.kind === 'video' ? 'vid_' : media.kind === 'file' ? 'file_' : 'img_';
    const filename = prefix + crypto.randomBytes(16).toString('hex') + '.' + media.ext;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, media.buffer, { flag: 'wx', mode: 0o644 });
    try {
        db.prepare('INSERT INTO uploaded_media (filename, user_id) VALUES (?, ?)').run(filename, String(userId));
    } catch (error) {
        fs.unlinkSync(filePath);
        throw error;
    }
    const url = PUBLIC_BASE_URL + '/api/uploads/' + filename + (media.kind === 'file' ? '?name=' + encodeURIComponent(media.name) : '');
    return {
        url,
        type: media.kind,
        filename,
        name: media.name || filename,
        size: media.buffer.length,
        mime_type: media.mimeType || '',
        ...(media.dimensions || {})
    };
}

async function getRecipientChatId(reminder, messageIds, userId) {
    const directChatId = String(userId);
    if (messageIds[directChatId]) return directChatId;

    const mappedParticipants = db.prepare('SELECT chat_id FROM participants WHERE teacher_id = ? AND user_id = ?')
        .all(reminder.user_id, directChatId);
    const mappedParticipant = mappedParticipants.find(participant => messageIds[String(participant.chat_id)]);
    if (mappedParticipant) return String(mappedParticipant.chat_id);

    const legacyParticipants = db.prepare('SELECT id, chat_id FROM participants WHERE teacher_id = ? AND user_id IS NULL')
        .all(reminder.user_id)
        .filter(participant => messageIds[String(participant.chat_id)] && /^-?[0-9]+$/.test(String(participant.chat_id)));

    for (const participant of legacyParticipants) {
        try {
            const response = await fetch('https://platform-api2.max.ru/chats/' + encodeURIComponent(participant.chat_id), {
                headers: { Authorization: BOT_TOKEN }
            });
            if (!response.ok) continue;

            const chat = await response.json().catch(() => null);
            const dialogUserId = chat?.dialog_with_user?.user_id;
            if (dialogUserId === undefined || String(dialogUserId) !== directChatId) continue;

            db.prepare('UPDATE participants SET user_id = ? WHERE id = ? AND user_id IS NULL')
                .run(directChatId, participant.id);
            return String(participant.chat_id);
        } catch (error) {
            continue;
        }
    }

    return null;
}

function sanitizeUploadedMedia(images, userId) {
    if (images === undefined || images === null) return [];
    if (!Array.isArray(images) || images.length > 3) return null;
    let publicOrigin;
    try {
        const publicUrl = new URL(PUBLIC_BASE_URL);
        if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) return null;
        publicOrigin = publicUrl.origin;
    } catch (error) {
        return null;
    }
    const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
    const result = [];
    for (const item of images) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        if (typeof item.filename !== 'string' || typeof item.url !== 'string') return null;
        let extension;
        if (item.type === 'image') {
            const match = /^img_([a-f0-9]{16}|[a-f0-9]{32})\.(png|jpg|gif|webp)$/i.exec(item.filename);
            if (!match) return null;
            extension = match[2].toLowerCase();
        } else if (item.type === 'file') {
            const match = /^file_([a-f0-9]{32})\.([a-z0-9]+)$/i.exec(item.filename);
            if (!match || !FILE_TYPES[match[2].toLowerCase()]) return null;
            extension = match[2].toLowerCase();
        } else {
            return null;
        }
        let parsedUrl;
        try {
            parsedUrl = new URL(item.url);
        } catch (error) {
            return null;
        }
        const safeName = cleanUploadedFileName(item.name || item.filename, extension);
        const expectedSearch = item.type === 'file' ? '?name=' + encodeURIComponent(safeName) : '';
        if (parsedUrl.origin !== publicOrigin || parsedUrl.pathname !== '/api/uploads/' + item.filename || parsedUrl.search !== expectedSearch || parsedUrl.hash) return null;
        const filePath = path.join(uploadsDir, item.filename);
        let stat;
        let buffer;
        try {
            stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_UPLOAD_BYTES) return null;
            buffer = fs.readFileSync(filePath);
        } catch (error) {
            return null;
        }
        const owner = db.prepare('SELECT user_id FROM uploaded_media WHERE filename = ?').get(item.filename);
        if (owner && String(owner.user_id) !== String(userId)) return null;
        if (item.type === 'file' && (!owner || String(owner.user_id) !== String(userId))) return null;
        if (item.type === 'image') {
            const mimeType = extension === 'jpg' ? 'image/jpeg' : 'image/' + extension;
            if (!hasValidMediaSignature(buffer, mimeType)) return null;
            const dimensions = getImageDimensions(buffer, mimeType);
            if (!dimensions || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) return null;
            result.push({ url: parsedUrl.toString(), type: 'image', filename: item.filename, name: safeName, size: stat.size, mime_type: mimeType, width: dimensions.width, height: dimensions.height });
        } else {
            if (!hasValidFileSignature(buffer, extension)) return null;
            result.push({ url: parsedUrl.toString(), type: 'file', filename: item.filename, name: safeName, size: stat.size, mime_type: FILE_TYPES[extension] });
        }
    }
    return result;
}

function cleanupUnusedUploadedMedia(userId, previousMedia, nextMedia) {
    const nextFilenames = new Set((Array.isArray(nextMedia) ? nextMedia : []).map(item => item?.filename).filter(Boolean));
    const previousFilenames = new Set((Array.isArray(previousMedia) ? previousMedia : []).map(item => item?.filename).filter(Boolean));
    const referenced = new Set();
    db.prepare('SELECT images FROM reminders WHERE user_id = ?').all(userId).forEach(row => {
        safeJsonParse(row.images, []).forEach(item => {
            if (item && item.filename) referenced.add(item.filename);
        });
    });
    for (const filename of previousFilenames) {
        if (nextFilenames.has(filename) || referenced.has(filename)) continue;
        const owner = db.prepare('SELECT user_id FROM uploaded_media WHERE filename = ?').get(filename);
        if (!owner || String(owner.user_id) !== String(userId)) continue;
        const filePath = path.join(__dirname, '..', 'data', 'uploads', filename);
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            db.prepare('DELETE FROM uploaded_media WHERE filename = ? AND user_id = ?').run(filename, String(userId));
        } catch (error) {
            console.error('Failed to clean unused uploaded file:', error.message);
        }
    }
}

function sanitizeQuickReplies(quickReplies) {
    if (quickReplies === undefined || quickReplies === null) return [];
    if (!Array.isArray(quickReplies) || quickReplies.length > 20) return null;

    return quickReplies
        .filter(reply => reply && typeof reply === 'object' && !Array.isArray(reply))
        .map(reply => ({
            question: typeof reply.question === 'string' ? reply.question.trim().slice(0, 150) : '',
            answer: typeof reply.answer === 'string' ? reply.answer.trim().slice(0, 500) : ''
        }))
        .filter(reply => reply.question.length > 0);
}

function isValidScheduledTime(value) {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return false;

    const [, year, month, day, hours, minutes] = match.map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day, hours, minutes));
    return parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day &&
        parsed.getUTCHours() === hours &&
        parsed.getUTCMinutes() === minutes;
}


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

    const groupNames = validRecipients.filter(name => name !== 'Себе' && !/^person:[0-9]+$/.test(name));
    if (groupNames.length > 0) {
        const placeholders = groupNames.map(() => '?').join(',');
        const query = `
            SELECT DISTINCT p.chat_id
            FROM participants p
            JOIN participant_groups pg ON pg.participant_id = p.id
            JOIN groups g ON pg.group_id = g.id
            WHERE g.user_id = ? AND g.name IN (${placeholders})
        `;
        const rows = db.prepare(query).all(userId, ...groupNames);
        rows.forEach(row => {
            const chatId = String(row.chat_id);
            if (!targetChatIds.includes(chatId)) targetChatIds.push(chatId);
        });
    }


    const personIds = validRecipients
        .filter(value => /^person:[0-9]+$/.test(value))
        .map(value => Number(value.slice(7)))
        .filter(id => Number.isSafeInteger(id) && id > 0);
    if (personIds.length > 0) {
        const placeholders = personIds.map(() => '?').join(',');
        const rows = db.prepare(`
            SELECT chat_id FROM participants
            WHERE teacher_id = ? AND id IN (${placeholders})
        `).all(userId, ...personIds);
        rows.forEach(row => {
            const chatId = String(row.chat_id);
            if (!targetChatIds.includes(chatId)) targetChatIds.push(chatId);
        });
    }
    return targetChatIds;
}

async function sendImmediateReminder(reminderId, userId, recipients, text, quickReplies, images, repeatType, repeatTime) {
    const targetChatIds = getTargetChatIds(userId, recipients);
    const reminder = db.prepare('SELECT sender_name FROM reminders WHERE id = ? AND user_id = ?').get(reminderId, userId);
    const sendResult = await sendBroadcastMessage(reminderId, targetChatIds, text, quickReplies, images, { name: reminder?.sender_name || '', id: userId });

    db.prepare('UPDATE reminders SET sent_at = ?, message_ids = ? WHERE id = ? AND user_id = ?')
        .run(getMoscowDateTimeString(), JSON.stringify(sendResult.messageIds || {}), reminderId, userId);

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

router.get('/public/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid reminder id' });
        }

        const reminder = db.prepare('SELECT user_id, title, description, sender_name, quick_replies, images, message_ids FROM reminders WHERE id = ?').get(id);
        const messageIds = safeJsonParse(reminder?.message_ids, {});
        const chatId = reminder ? await getRecipientChatId(reminder, messageIds, req.userId) : null;
        if (!reminder || !chatId) {
            return res.status(404).json({ error: 'Reminder not found' });
        }

        const quickReplies = safeJsonParse(reminder.quick_replies, []);
        const publicReplies = Array.isArray(quickReplies)
            ? quickReplies.map((reply, index) => ({
                index,
                question: typeof reply?.question === 'string' ? reply.question.trim().slice(0, 150) : '',
                answer: typeof reply?.answer === 'string' ? reply.answer.trim().slice(0, 500) : ''
            })).filter(reply => reply.question && reply.answer)
                .map(({ index, question, answer }) => ({ index, question, answer }))
            : [];
        const savedImages = safeJsonParse(reminder.images, []);
        const validImages = sanitizeUploadedMedia(savedImages, reminder.user_id);
        const publicImages = Array.isArray(validImages)
            ? validImages.map(({ url, type, name, size, mime_type, width, height }) => ({ url, type, name, size, mime_type, width, height }))
            : [];

        res.setHeader('Cache-Control', 'no-store');
        return res.json({
            title: reminder.title || '',
            description: reminder.description || '',
            sender: {
                name: reminder.sender_name || '',
                id: String(reminder.user_id)
            },
            images: publicImages,
            quick_replies: publicReplies
        });
    } catch (error) {
        console.error('Failed to fetch recipient reminder:', error.message);
        return res.status(500).json({ error: 'Failed to fetch reminder' });
    }
});

router.get('/', (req, res) => {
    try {
        // Keep only five sent reminders and five upcoming scheduled reminders.
        // Remove stored responses with pruned records to avoid orphaned database rows.
        const pruneReminderHistory = db.transaction(userId => {
            db.prepare(`
                DELETE FROM responses
                WHERE reminder_id IN (
                    SELECT id FROM reminders
                    WHERE user_id = ? AND status = 'sent'
                    ORDER BY julianday(COALESCE(sent_at, created_at)) DESC, id DESC
                    LIMIT -1 OFFSET 5
                )
            `).run(userId);

            db.prepare(`
                DELETE FROM reminders
                WHERE user_id = ? AND status = 'sent'
                  AND id NOT IN (
                      SELECT id FROM reminders
                      WHERE user_id = ? AND status = 'sent'
                      ORDER BY julianday(COALESCE(sent_at, created_at)) DESC, id DESC
                      LIMIT 5
                  )
            `).run(userId, userId);

            db.prepare(`
                DELETE FROM responses
                WHERE reminder_id IN (
                    SELECT id FROM reminders
                    WHERE user_id = ? AND status = 'scheduled'
                      AND id NOT IN (
                          SELECT id FROM reminders
                          WHERE user_id = ? AND status = 'scheduled'
                          ORDER BY
                              CASE WHEN scheduled_time IS NULL THEN 1 ELSE 0 END,
                              scheduled_time ASC,
                              id ASC
                          LIMIT 5
                      )
                )
            `).run(userId, userId);

            db.prepare(`
                DELETE FROM reminders
                WHERE user_id = ? AND status = 'scheduled'
                  AND id NOT IN (
                      SELECT id FROM reminders
                      WHERE user_id = ? AND status = 'scheduled'
                      ORDER BY
                          CASE WHEN scheduled_time IS NULL THEN 1 ELSE 0 END,
                          scheduled_time ASC,
                          id ASC
                      LIMIT 5
                  )
            `).run(userId, userId);
        });
        pruneReminderHistory(req.userId);

        const rows = db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY id DESC').all(req.userId);
        const parsed = rows.map(r => ({
            ...r,
            recipients: safeJsonParse(r.recipients, []),
            quick_replies: safeJsonParse(r.quick_replies, []),
            images: safeJsonParse(r.images, [])
        }));
        res.json(parsed);
    } catch (e) {
        console.error('Failed to prune or fetch reminders:', e);
        res.status(500).json({ error: 'Failed to fetch reminders' });
    }
});

router.post('/upload-media', (req, res) => {
    try {
        const media = decodeUploadedMedia(req.body?.media_data, 'image', req.body?.file_name);
        return res.json(storeUploadedMedia(media, req.userId));
    } catch (error) {
        const messages = {
            FILE_TOO_LARGE: 'Каждый файл должен быть не больше 10 МБ',
            IMAGE_TOO_LARGE: 'Размер фото не должен превышать 7680 × 7680 пикселей',
            INVALID_IMAGE: 'Поддерживаются изображения PNG, JPEG, GIF и WEBP'
        };
        if (messages[error.message]) return res.status(400).json({ error: messages[error.message] });
        if (error.message === 'INVALID_UPLOAD') return res.status(400).json({ error: 'Не удалось прочитать файл' });
        console.error('Failed to store uploaded image:', error.message);
        return res.status(500).json({ error: 'Не удалось загрузить фото' });
    }
});

router.post('/upload-image', (req, res) => {
    try {
        const media = decodeUploadedMedia(req.body?.image_data, 'image', req.body?.file_name);
        return res.json(storeUploadedMedia(media, req.userId));
    } catch (error) {
        const messages = {
            FILE_TOO_LARGE: 'Каждый файл должен быть не больше 10 МБ',
            IMAGE_TOO_LARGE: 'Размер фото не должен превышать 7680 × 7680 пикселей',
            INVALID_IMAGE: 'Поддерживаются изображения PNG, JPEG, GIF и WEBP'
        };
        if (messages[error.message]) return res.status(400).json({ error: messages[error.message] });
        if (error.message === 'INVALID_UPLOAD') return res.status(400).json({ error: 'Не удалось прочитать фото' });
        console.error('Failed to store uploaded image:', error.message);
        return res.status(500).json({ error: 'Не удалось загрузить фото' });
    }
});

router.post('/upload-file', (req, res) => {
    try {
        const media = decodeUploadedMedia(req.body?.media_data, 'file', req.body?.file_name);
        return res.json(storeUploadedMedia(media, req.userId));
    } catch (error) {
        if (error.message === 'FILE_TOO_LARGE') return res.status(400).json({ error: 'Каждый файл должен быть не больше 10 МБ' });
        if (error.message === 'INVALID_UPLOAD') return res.status(400).json({ error: 'Не удалось прочитать файл' });
        if (error.message === 'INVALID_FILE') return res.status(400).json({ error: 'Формат файла не поддерживается' });
        console.error('Failed to store uploaded file:', error.message);
        return res.status(500).json({ error: 'Не удалось загрузить файл' });
    }
});

router.delete('/uploads/:filename', (req, res) => {
    const filename = String(req.params.filename || '');
    const match = /^file_[a-f0-9]{32}\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf|md|odt|ods|odp|zip)$/i.exec(filename)
        || /^img_[a-f0-9]{32}\.(png|jpg|gif|webp)$/i.exec(filename);
    if (!match) return res.status(400).json({ error: 'Некорректный файл' });
    const owner = db.prepare('SELECT user_id FROM uploaded_media WHERE filename = ?').get(filename);
    if (!owner || String(owner.user_id) !== String(req.userId)) return res.status(404).json({ error: 'Файл не найден' });
    const rows = db.prepare('SELECT images FROM reminders WHERE user_id = ?').all(req.userId);
    const isAttached = rows.some(row => safeJsonParse(row.images, []).some(item => item && item.filename === filename));
    if (isAttached) return res.status(409).json({ error: 'Файл уже прикреплён к сохранённому напоминанию' });
    try {
        const filePath = path.join(__dirname, '..', 'data', 'uploads', filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        db.prepare('DELETE FROM uploaded_media WHERE filename = ? AND user_id = ?').run(filename, String(req.userId));
        return res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete uploaded file:', error.message);
        return res.status(500).json({ error: 'Не удалось удалить файл' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        const reminder = db.prepare('SELECT status, message_ids, images FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
        if (!reminder) return res.json({ success: true });
        const messageIds = safeJsonParse(reminder.message_ids, {});
        if (reminder.status === 'sent' && Object.keys(messageIds).length === 0) {
            return res.status(409).json({ error: 'Для этого старого сообщения не сохранён ID в MAX, поэтому удалить его у получателей автоматически нельзя' });
        }
        let deletedMessages = 0;
        const remainingMessageIds = {};
        for (const [chatId, mid] of Object.entries(messageIds)) {
            if (!await deleteLinkedReplyMessages(id, chatId, mid)) {
                remainingMessageIds[chatId] = mid;
                continue;
            }

            if (await deleteMaxMessage(BOT_TOKEN, mid)) {
                deletedMessages++;
            } else {
                remainingMessageIds[chatId] = mid;
            }
        }
        if (Object.keys(remainingMessageIds).length > 0) {
            db.prepare('UPDATE reminders SET message_ids = ? WHERE id = ? AND user_id = ?')
                .run(JSON.stringify(remainingMessageIds), id, req.userId);
            return res.status(502).json({ error: 'Не удалось удалить сообщение у всех получателей. Повторите попытку' });
        }
        db.transaction(() => {
            db.prepare('DELETE FROM responses WHERE reminder_id = ?').run(id);
            db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, req.userId);
        })();
        cleanupUnusedUploadedMedia(req.userId, safeJsonParse(reminder.images, []), []);
        res.json({ success: true, deleted_messages: deletedMessages });
    } catch (e) {
        console.error('Failed to delete reminder:', e);
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
        } = req.body || {};

        if (typeof send_now !== 'boolean') {
            return res.status(400).json({ error: 'send_now must be a boolean' });
        }

        if (!title || typeof title !== 'string') {
            return res.status(400).json({ error: 'Title required' });
        }

        const cleanTitle = title.trim().slice(0, 150);
        if (cleanTitle.length === 0) {
            return res.status(400).json({ error: 'Title cannot be empty' });
        }

        const cleanDesc = typeof description === 'string' ? description.trim().slice(0, 2000) : '';
        const cleanSenderName = typeof req.userName === 'string' ? req.userName.trim().slice(0, 80) : '';
        const validRepeatTypes = ['Никогда', 'Каждый день', 'Каждую неделю', 'Каждый месяц'];
        if (!validRepeatTypes.includes(repeat_type)) {
            return res.status(400).json({ error: 'Invalid repeat_type' });
        }
        const cleanRepeatType = repeat_type;
        const cleanRepeatTime = typeof repeat_time === 'string' ? repeat_time.slice(0, 10) : null;
        if (cleanRepeatType !== 'Никогда' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cleanRepeatTime || '')) {
            return res.status(400).json({ error: 'repeat_time must use HH:mm format' });
        }
        if (!send_now && (!isValidScheduledTime(scheduled_time) || scheduled_time <= getMoscowDateTimeString())) {
            return res.status(400).json({ error: 'scheduled_time must be a valid future date and time' });
        }
        const cleanScheduledTime = send_now && cleanRepeatType !== 'Никогда' ? getMoscowDateTimeString() : (typeof scheduled_time === 'string' ? scheduled_time.slice(0, 30) : null);
        const status = send_now && cleanRepeatType === 'Никогда' ? 'sent' : 'scheduled';

        const validRecipients = Array.isArray(recipients) ? recipients.slice(0, 50).map(r => String(r).trim().slice(0, 100)).filter(r => r.length > 0) : [];
        if (validRecipients.length === 0) {
            return res.status(400).json({ error: 'At least one recipient required' });
        }

        const validReplies = sanitizeQuickReplies(quick_replies);
        if (!validReplies) {
            return res.status(400).json({ error: 'quick_replies must contain at most 20 items' });
        }

        const validImages = sanitizeUploadedMedia(images, req.userId);
        if (!validImages) {
            return res.status(400).json({ error: 'Вложения должны быть загружены через приложение. Максимум 3 файла по 10 МБ' });
        }

        const stmt = db.prepare(`
            INSERT INTO reminders (
                user_id, title, description, sender_name, send_now, scheduled_time, repeat_type, repeat_time, recipients, quick_replies, images, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = stmt.run(
            req.userId,
            cleanTitle,
            cleanDesc,
            cleanSenderName,
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
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const existing = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
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
        } = req.body || {};

        if (typeof send_now !== 'boolean') {
            return res.status(400).json({ error: 'send_now must be a boolean' });
        }

        if (!title || typeof title !== 'string') {
            return res.status(400).json({ error: 'Title required' });
        }

        const cleanTitle = title.trim().slice(0, 150);
        if (cleanTitle.length === 0) {
            return res.status(400).json({ error: 'Title cannot be empty' });
        }

        const cleanDesc = typeof description === 'string' ? description.trim().slice(0, 2000) : '';
        const cleanSenderName = typeof req.userName === 'string' ? req.userName.trim().slice(0, 80) : '';
        const validRepeatTypes = ['Никогда', 'Каждый день', 'Каждую неделю', 'Каждый месяц'];
        if (!validRepeatTypes.includes(repeat_type)) {
            return res.status(400).json({ error: 'Invalid repeat_type' });
        }
        const cleanRepeatType = repeat_type;
        const cleanRepeatTime = typeof repeat_time === 'string' ? repeat_time.slice(0, 10) : null;
        if (cleanRepeatType !== 'Никогда' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cleanRepeatTime || '')) {
            return res.status(400).json({ error: 'repeat_time must use HH:mm format' });
        }
        if (!send_now && (!isValidScheduledTime(scheduled_time) || scheduled_time <= getMoscowDateTimeString())) {
            return res.status(400).json({ error: 'scheduled_time must be a valid future date and time' });
        }
        const cleanScheduledTime = send_now && cleanRepeatType !== 'Никогда' ? getMoscowDateTimeString() : (typeof scheduled_time === 'string' ? scheduled_time.slice(0, 30) : null);
        const status = send_now && cleanRepeatType === 'Никогда' ? 'sent' : 'scheduled';

        const validRecipients = Array.isArray(recipients) ? recipients.slice(0, 50).map(r => String(r).trim().slice(0, 100)).filter(r => r.length > 0) : [];
        if (validRecipients.length === 0) {
            return res.status(400).json({ error: 'At least one recipient required' });
        }

        const validReplies = sanitizeQuickReplies(quick_replies);
        if (!validReplies) {
            return res.status(400).json({ error: 'quick_replies must contain at most 20 items' });
        }

        const validImages = sanitizeUploadedMedia(images, req.userId);
        if (!validImages) {
            return res.status(400).json({ error: 'Вложения должны быть загружены через приложение. Максимум 3 файла по 10 МБ' });
        }
        const oldImages = safeJsonParse(existing.images, []);

        if (existing.status === 'sent') {
            const oldRecipients = safeJsonParse(existing.recipients, []);
            const oldMessageIds = safeJsonParse(existing.message_ids, {});
            if (Object.keys(oldMessageIds).length === 0) {
                return res.status(409).json({ error: 'Для этого старого сообщения не сохранены ID в MAX. Изменение доступно для сообщений, отправленных после обновления' });
            }
            const oldQuickReplies = safeJsonParse(existing.quick_replies, []);
            const oldImages = safeJsonParse(existing.images, []);
            const oldChatIds = getTargetChatIds(req.userId, oldRecipients);
            const newChatIds = getTargetChatIds(req.userId, validRecipients);
            const oldMediaSignature = (Array.isArray(oldImages) ? oldImages : []).map(item => ({
                type: item?.type || '',
                filename: item?.filename || '',
                url: item?.url || ''
            }));
            const newMediaSignature = validImages.map(item => ({
                type: item.type,
                filename: item.filename,
                url: item.url
            }));
            const attachmentDataChanged = JSON.stringify(oldQuickReplies) !== JSON.stringify(validReplies)
                || JSON.stringify(oldMediaSignature) !== JSON.stringify(newMediaSignature)
                || (existing.sender_name || '') !== cleanSenderName;
            const updatedMessageIds = {};
            const recipientsToSend = [];

            for (const chatId of oldChatIds) {
                const oldMid = oldMessageIds[chatId];
                if (!newChatIds.includes(chatId)) {
                    if (oldMid && !await deleteLinkedReplyMessages(id, chatId, oldMid)) {
                        return res.status(502).json({ error: 'Не удалось удалить ответ у исключённого получателя' });
                    }
                    if (oldMid && !await deleteMaxMessage(BOT_TOKEN, oldMid)) {
                        return res.status(502).json({ error: 'Не удалось удалить сообщение у исключённого получателя' });
                    }
                    continue;
                }

                if (attachmentDataChanged) {
                    if (oldMid && !await deleteLinkedReplyMessages(id, chatId, oldMid)) {
                        return res.status(502).json({ error: 'Не удалось удалить ответ на заменяемое сообщение. Повторите попытку' });
                    }
                    if (oldMid && !await deleteMaxMessage(BOT_TOKEN, oldMid)) {
                        return res.status(502).json({ error: 'Не удалось заменить старое сообщение. Повторите попытку' });
                    }
                    recipientsToSend.push(chatId);
                    continue;
                }

                if (oldMid && await editMaxMessage(BOT_TOKEN, oldMid, cleanTitle + (cleanDesc ? '\n\n' + cleanDesc : ''), { name: cleanSenderName, id: req.userId })) {
                    updatedMessageIds[chatId] = oldMid;
                } else {
                    if (oldMid && !await deleteLinkedReplyMessages(id, chatId, oldMid)) {
                        return res.status(502).json({ error: 'Не удалось удалить ответ на заменяемое сообщение. Повторите попытку' });
                    }
                    if (oldMid && !await deleteMaxMessage(BOT_TOKEN, oldMid)) {
                        return res.status(502).json({ error: 'Не удалось заменить старое сообщение. Повторите попытку' });
                    }
                    recipientsToSend.push(chatId);
                }
            }

            for (const chatId of newChatIds) {
                if (!oldChatIds.includes(chatId)) recipientsToSend.push(chatId);
            }

            if (recipientsToSend.length > 0) {
                const sendResult = await sendBroadcastMessage(
                    id,
                    recipientsToSend,
                    cleanTitle + (cleanDesc ? '\n\n' + cleanDesc : ''),
                    validReplies,
                    validImages,
                    { name: cleanSenderName, id: req.userId }
                );
                Object.assign(updatedMessageIds, sendResult.messageIds || {});
            }

            db.prepare(`
                UPDATE reminders
                SET title = ?, description = ?, send_now = 1, scheduled_time = NULL,
                    repeat_type = 'Никогда', repeat_time = NULL, recipients = ?,
                    quick_replies = ?, images = ?, sender_name = ?, status = 'sent',
                    message_ids = ?, pending_recipients = NULL
                WHERE id = ? AND user_id = ?
            `).run(
                cleanTitle,
                cleanDesc,
                JSON.stringify(validRecipients),
                JSON.stringify(validReplies),
                JSON.stringify(validImages),
                cleanSenderName,
                JSON.stringify(updatedMessageIds),
                id,
                req.userId
            );
            cleanupUnusedUploadedMedia(req.userId, oldImages, validImages);

            return res.json({
                id,
                status: 'sent',
                updated: Object.keys(updatedMessageIds).length,
                failed: recipientsToSend.filter(chatId => !updatedMessageIds[chatId]).length
            });
        }

        const stmt = db.prepare(`
            UPDATE reminders
            SET title = ?, description = ?, sender_name = ?, send_now = ?, scheduled_time = ?, repeat_type = ?, repeat_time = ?, recipients = ?, quick_replies = ?, images = ?, status = ?, pending_recipients = NULL
            WHERE id = ? AND user_id = ?
        `);

        stmt.run(
            cleanTitle,
            cleanDesc,
            cleanSenderName,
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
        cleanupUnusedUploadedMedia(req.userId, oldImages, validImages);
        res.json({ id, status });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update reminder' });
    }
});

module.exports = router;
