const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { sendBroadcastMessage, sendQuickReplyMessage, deleteMaxMessage, deleteLinkedReplyMessages, editMaxMessage } = require('../bot');
const { BOT_TOKEN } = require('../auth');
const { getMoscowDateTimeString, calculateNextScheduledTime } = require('../scheduler');
const { createWorkbook } = require('../xlsx');

const router = express.Router();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');

if (!PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is required');
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
    const match = /^data:([^;,]+);base64,([a-z0-9+/]*={0,2})$/i.exec(data);
    if (!match) throw new Error('INVALID_UPLOAD');
    const declaredMimeType = match[1].toLowerCase();
    const encoded = match[2];
    if (encoded.length % 4 !== 0) throw new Error('INVALID_UPLOAD');
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.toString('base64') !== encoded) throw new Error('INVALID_UPLOAD');
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

    const extension = 'bin';
    return { buffer, kind: 'file', ext: extension, mimeType: 'application/octet-stream', name: cleanUploadedFileName(originalName, extension) };
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
    if (!Array.isArray(images) || images.length > 6) return null;
    const imageCount = images.filter(item => item?.type === 'image').length;
    const fileCount = images.filter(item => item?.type === 'file').length;
    if (imageCount > 3 || fileCount > 3 || imageCount + fileCount !== images.length) return null;
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
            const match = /^file_([a-f0-9]{32})\.([a-z0-9]{1,16})$/i.exec(item.filename);
            if (!match) return null;
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
            if (!stat.isFile() || stat.size < 0 || stat.size > MAX_UPLOAD_BYTES) return null;
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
            result.push({ url: parsedUrl.toString(), type: 'file', filename: item.filename, name: safeName, size: stat.size, mime_type: FILE_TYPES[extension] || 'application/octet-stream' });
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


function cleanupUnreferencedUploadedMedia(filenames) {
    const candidates = [...new Set((Array.isArray(filenames) ? filenames : []).filter(filename =>
        typeof filename === 'string' && /^(?:img|file|vid)_[a-f0-9]{16,32}\.[a-z0-9]+$/i.test(filename)
    ))];
    if (!candidates.length) return;

    const referenced = new Set();
    db.prepare('SELECT images FROM reminders').all().forEach(row => {
        safeJsonParse(row.images, []).forEach(item => {
            if (item && typeof item.filename === 'string') referenced.add(item.filename);
        });
    });
    db.prepare('SELECT filename FROM feedback_files').all().forEach(row => referenced.add(row.filename));

    candidates.forEach(filename => {
        if (referenced.has(filename)) return;
        const owner = db.prepare('SELECT filename FROM uploaded_media WHERE filename = ?').get(filename);
        if (!owner) return;
        try {
            const filePath = path.join(__dirname, '..', 'data', 'uploads', filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            db.prepare('DELETE FROM uploaded_media WHERE filename = ?').run(filename);
        } catch (error) {
            console.error('Failed to clean unused uploaded media:', error.message);
        }
    });
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

function sanitizeFeedbackOptions(feedbackOptions) {
    if (feedbackOptions === undefined || feedbackOptions === null) return [];
    if (!Array.isArray(feedbackOptions) || feedbackOptions.length > 20) return null;
    return feedbackOptions
        .filter(option => typeof option === 'string')
        .map(option => option.trim().slice(0, 200))
        .filter(Boolean);
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

const RECIPIENT_DOWNLOAD_TICKET_TTL_SECONDS = 60 * 60;

function createRecipientDownloadToken(reminderId, filename, userId) {
    const now = Math.floor(Date.now() / 1000);
    const normalizedReminderId = Number(reminderId);
    const normalizedUserId = String(userId);
    db.prepare('DELETE FROM recipient_download_tickets WHERE expires_at <= ?').run(now);

    const existing = db.prepare('SELECT token_hash, expires_at FROM recipient_download_tickets WHERE reminder_id = ? AND filename = ? AND user_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1')
        .get(normalizedReminderId, filename, normalizedUserId, now);

    if (existing) {
        const token = crypto.createHmac('sha256', BOT_TOKEN)
            .update([normalizedReminderId, filename, normalizedUserId, existing.expires_at].join(':'))
            .digest('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        if (tokenHash === existing.token_hash) return token;
        db.prepare('DELETE FROM recipient_download_tickets WHERE reminder_id = ? AND filename = ? AND user_id = ?')
            .run(normalizedReminderId, filename, normalizedUserId);
    }

    const expiresAt = now + RECIPIENT_DOWNLOAD_TICKET_TTL_SECONDS;
    const token = crypto.createHmac('sha256', BOT_TOKEN)
        .update([normalizedReminderId, filename, normalizedUserId, expiresAt].join(':'))
        .digest('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('INSERT INTO recipient_download_tickets (token_hash, reminder_id, filename, user_id, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(tokenHash, normalizedReminderId, filename, normalizedUserId, expiresAt);
    return token;
}

function getRecipientDownloadTicket(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const access = db.prepare('SELECT reminder_id AS id, filename, user_id AS userId, expires_at AS expiresAt FROM recipient_download_tickets WHERE token_hash = ?')
        .get(tokenHash);
    if (!access) return null;
    if (access.expiresAt <= Math.floor(Date.now() / 1000)) {
        db.prepare('DELETE FROM recipient_download_tickets WHERE token_hash = ?').run(tokenHash);
        return null;
    }
    return access;
}

async function handleRecipientMediaDownload(req, res) {
    try {
        const access = getRecipientDownloadTicket(req.params.token);
        if (!access) return res.status(404).json({ error: 'File not found or download link expired' });

        const reminder = db.prepare('SELECT user_id, images, message_ids FROM reminders WHERE id = ?').get(access.id);
        const messageIds = safeJsonParse(reminder?.message_ids, {});
        const chatId = reminder ? await getRecipientChatId(reminder, messageIds, access.userId) : null;
        if (!reminder || !chatId) {
            return res.status(404).json({ error: 'File not found' });
        }

        const savedMedia = safeJsonParse(reminder.images, []);
        const validMedia = sanitizeUploadedMedia(savedMedia, reminder.user_id);
        const media = Array.isArray(validMedia)
            ? validMedia.find(item => item.filename === access.filename && item.type === 'file')
            : null;
        if (!media) return res.status(404).json({ error: 'File not found' });

        const filePath = path.join(__dirname, '..', 'data', 'uploads', access.filename);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.type(media.mime_type || 'application/octet-stream');
        res.attachment(media.name);
        return res.sendFile(filePath);
    } catch (error) {
        console.error('Failed to download recipient attachment:', error.message);
        return res.status(500).json({ error: 'Failed to download attachment' });
    }
}

router.get('/public/:id/media/:filename', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const filename = String(req.params.filename || '');
        if (!Number.isSafeInteger(id) || id <= 0 || !/^(?:img_[a-f0-9]{16}(?:[a-f0-9]{16})?\.(?:png|jpg|gif|webp)|file_[a-f0-9]{32}\.[a-z0-9]{1,16})$/i.test(filename)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const reminder = db.prepare('SELECT user_id, images, message_ids FROM reminders WHERE id = ?').get(id);
        const messageIds = safeJsonParse(reminder?.message_ids, {});
        const chatId = reminder ? await getRecipientChatId(reminder, messageIds, req.userId) : null;
        if (!reminder || !chatId) {
            return res.status(404).json({ error: 'File not found' });
        }

        const savedMedia = safeJsonParse(reminder.images, []);
        const validMedia = sanitizeUploadedMedia(savedMedia, reminder.user_id);
        const media = Array.isArray(validMedia) ? validMedia.find(item => item.filename === filename) : null;
        if (!media) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = path.join(__dirname, '..', 'data', 'uploads', filename);
        res.setHeader('Content-Type', media.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', media.type === 'file'
            ? `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(media.name)}`
            : 'inline');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        return res.sendFile(filePath);
    } catch (error) {
        console.error('Failed to fetch recipient attachment:', error.message);
        return res.status(500).json({ error: 'Failed to fetch attachment' });
    }
});

router.post('/public/:id/questions', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const questionText = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, 500) : '';
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid reminder id' });
        if (!questionText) return res.status(400).json({ error: 'Введите вопрос' });

        const reminder = db.prepare('SELECT user_id, message_ids FROM reminders WHERE id = ?').get(id);
        const messageIds = safeJsonParse(reminder?.message_ids, {});
        const chatId = reminder ? await getRecipientChatId(reminder, messageIds, req.userId) : null;
        if (!reminder || !chatId) return res.status(404).json({ error: 'Reminder not found' });

        const participant = db.prepare('SELECT name FROM participants WHERE teacher_id = ? AND (chat_id = ? OR user_id = ?) LIMIT 1')
            .get(reminder.user_id, chatId, String(req.userId));
        const suppliedName = typeof req.body?.recipient_name === 'string' ? req.body.recipient_name.trim().slice(0, 150) : '';
        const recipientName = suppliedName || participant?.name || 'Получатель';
        const result = db.prepare('INSERT INTO recipient_questions (reminder_id, chat_id, recipient_user_id, recipient_name, question) VALUES (?, ?, ?, ?, ?)')
            .run(id, chatId, String(req.userId), recipientName, questionText);

        res.setHeader('Cache-Control', 'no-store');
        return res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Failed to save recipient question:', error.message);
        return res.status(500).json({ error: 'Не удалось отправить вопрос' });
    }
});

router.post('/public/:id/feedback/profile', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid reminder id' });
        const reminder = db.prepare('SELECT user_id, feedback_enabled, message_ids FROM reminders WHERE id = ?').get(id);
        if (!reminder || !reminder.feedback_enabled) return res.status(404).json({ error: 'Feedback is unavailable' });
        const chatId = await getRecipientChatId(reminder, safeJsonParse(reminder.message_ids, {}), req.userId);
        if (!chatId) return res.status(404).json({ error: 'Reminder not found' });
        const name = typeof req.body?.recipient_name === 'string' ? req.body.recipient_name.trim().slice(0, 150) : '';
        if (!name) return res.json({ success: true, updated: false });
        const result = db.prepare("UPDATE feedback_submissions SET recipient_name = ? WHERE reminder_id = ? AND chat_id = ? AND recipient_name = ''")
            .run(name, id, chatId);
        res.json({ success: true, updated: result.changes > 0 });
    } catch (error) {
        console.error('Failed to update feedback respondent profile:', error.message);
        res.status(500).json({ error: 'Не удалось обновить имя получателя' });
    }
});

router.post('/public/:id/feedback', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid reminder id' });
        const reminder = db.prepare('SELECT user_id, feedback_enabled, feedback_allow_files, feedback_options, message_ids, repeat_type FROM reminders WHERE id = ?').get(id);
        if (!reminder || !reminder.feedback_enabled || reminder.repeat_type && reminder.repeat_type !== 'Никогда') return res.status(404).json({ error: 'Feedback is unavailable' });
        const messageIds = safeJsonParse(reminder.message_ids, {});
        const chatId = await getRecipientChatId(reminder, messageIds, req.userId);
        if (!chatId) return res.status(404).json({ error: 'Reminder not found' });
        const options = safeJsonParse(reminder.feedback_options, []).filter(item => typeof item === 'string' && item.trim());
        const incoming = req.body?.answers && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers) ? req.body.answers : {};
        const selectedOption = typeof incoming.choice === 'string' ? incoming.choice.trim() : '';
        const answers = selectedOption && options.includes(selectedOption) ? { choice: selectedOption } : {};
        const files = Array.isArray(req.body?.files) ? req.body.files : [];
        if (Object.keys(answers).length === 0 && files.length === 0) return res.status(400).json({ error: 'Добавьте ответ или файл' });
        if (!reminder.feedback_allow_files && files.length) return res.status(400).json({ error: 'File attachments are disabled' });
        if (files.length > 3) return res.status(400).json({ error: 'Можно прикрепить не более 3 файлов' });
        const rawRecipient = req.body?.recipient_name;
        const recipientName = typeof rawRecipient === 'string' ? rawRecipient.trim().slice(0, 150) : '';
        const preparedFiles = [];
        for (const item of files) {
            const filename = typeof item?.filename === 'string' ? item.filename : '';
            const match = /^file_[a-f0-9]{32}\.([a-z0-9]{1,16})$/i.exec(filename);
            if (!match) return res.status(400).json({ error: 'Некорректный файл' });
            const owner = db.prepare('SELECT user_id FROM uploaded_media WHERE filename = ?').get(filename);
            const filePath = path.join(__dirname, '..', 'data', 'uploads', filename);
            if (!owner || String(owner.user_id) !== String(req.userId) || !fs.existsSync(filePath)) return res.status(400).json({ error: 'Файл не найден' });
            const stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size < 0 || stat.size > MAX_UPLOAD_BYTES) return res.status(400).json({ error: 'Каждый файл должен быть не больше 10 МБ' });
            const buffer = fs.readFileSync(filePath);
            const extension = match[1].toLowerCase();
            if (FILE_TYPES[extension] && !hasValidFileSignature(buffer, extension)) return res.status(400).json({ error: 'Формат файла не поддерживается' });
            preparedFiles.push({ filename, name: cleanUploadedFileName(item.name || filename, extension), size: stat.size, mime_type: FILE_TYPES[extension] || 'application/octet-stream' });
        }
        const previousFiles = db.prepare('SELECT f.filename FROM feedback_files f JOIN feedback_submissions s ON s.id = f.submission_id WHERE s.reminder_id = ? AND s.chat_id = ?')
            .all(id, chatId)
            .map(file => file.filename);
        const save = db.transaction(() => {
            const existing = db.prepare('SELECT id FROM feedback_submissions WHERE reminder_id = ? AND chat_id = ?').get(id, chatId);
            let submissionId;
            if (existing) {
                submissionId = existing.id;
                db.prepare("UPDATE feedback_submissions SET answers = ?, recipient_name = CASE WHEN ? <> '' THEN ? ELSE recipient_name END, created_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .run(JSON.stringify(answers), recipientName, recipientName, submissionId);
            } else {
                submissionId = db.prepare('INSERT INTO feedback_submissions (reminder_id, chat_id, recipient_name, answers) VALUES (?, ?, ?, ?)')
                    .run(id, chatId, recipientName, JSON.stringify(answers)).lastInsertRowid;
            }
            db.prepare('DELETE FROM feedback_files WHERE submission_id = ?').run(submissionId);
            preparedFiles.forEach(file => {
                db.prepare('INSERT INTO feedback_files (submission_id, filename, name, size, mime_type) VALUES (?, ?, ?, ?, ?)')
                    .run(submissionId, file.filename, file.name, file.size, file.mime_type);
            });
            return submissionId;
        });
        save();
        cleanupUnreferencedUploadedMedia(previousFiles.filter(filename =>
            !preparedFiles.some(file => file.filename === filename)
        ));
        res.json({ success: true });
    } catch (error) {
        if (error.message === 'FILE_TOO_LARGE') return res.status(400).json({ error: 'Каждый файл должен быть не больше 10 МБ' });
        if (error.message === 'INVALID_FILE' || error.message === 'INVALID_UPLOAD') return res.status(400).json({ error: 'Формат файла не поддерживается' });
        console.error('Failed to save recipient feedback:', error.message);
        res.status(500).json({ error: 'Не удалось сохранить обратную связь' });
    }
});


router.get('/public/:id/feedback/files/:filename', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const filename = String(req.params.filename || '');
        if (!Number.isSafeInteger(id) || id <= 0 || !/^file_[a-f0-9]{32}\.[a-z0-9]{1,16}$/i.test(filename)) {
            return res.status(404).json({ error: 'File not found' });
        }
        const reminder = db.prepare('SELECT user_id, message_ids FROM reminders WHERE id = ?').get(id);
        const chatId = reminder
            ? await getRecipientChatId(reminder, safeJsonParse(reminder.message_ids, {}), req.userId)
            : null;
        if (!reminder || !chatId) return res.status(404).json({ error: 'File not found' });
        const file = db.prepare('SELECT f.name, f.mime_type FROM feedback_files f JOIN feedback_submissions s ON s.id = f.submission_id WHERE s.reminder_id = ? AND s.chat_id = ? AND f.filename = ?')
            .get(id, chatId, filename);
        if (!file) return res.status(404).json({ error: 'File not found' });
        const filePath = path.join(__dirname, '..', 'data', 'uploads', filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.type(file.mime_type || 'application/octet-stream');
        return res.download(filePath, file.name);
    } catch (error) {
        console.error('Failed to download recipient feedback attachment:', error.message);
        return res.status(500).json({ error: 'Не удалось скачать файл' });
    }
});

router.delete('/public/:id/feedback/files/:filename', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const filename = String(req.params.filename || '');
        if (!Number.isSafeInteger(id) || id <= 0 || !/^file_[a-f0-9]{32}\.[a-z0-9]{1,16}$/i.test(filename)) {
            return res.status(404).json({ error: 'File not found' });
        }
        const reminder = db.prepare('SELECT user_id, message_ids FROM reminders WHERE id = ?').get(id);
        const chatId = reminder
            ? await getRecipientChatId(reminder, safeJsonParse(reminder.message_ids, {}), req.userId)
            : null;
        if (!reminder || !chatId) return res.status(404).json({ error: 'File not found' });
        const submission = db.prepare('SELECT id, answers FROM feedback_submissions WHERE reminder_id = ? AND chat_id = ?')
            .get(id, chatId);
        const file = submission
            ? db.prepare('SELECT id FROM feedback_files WHERE submission_id = ? AND filename = ?').get(submission.id, filename)
            : null;
        if (file) {
            db.transaction(() => {
                db.prepare('DELETE FROM feedback_files WHERE id = ?').run(file.id);
                const remaining = db.prepare('SELECT id FROM feedback_files WHERE submission_id = ? LIMIT 1').get(submission.id);
                const answers = safeJsonParse(submission.answers, {});
                if (!remaining && !Object.keys(answers).some(key => typeof answers[key] === 'string' && answers[key].trim())) {
                    db.prepare('DELETE FROM feedback_submissions WHERE id = ?').run(submission.id);
                }
            })();
            cleanupUnreferencedUploadedMedia([filename]);
            return res.json({ success: true });
        }

        const owner = db.prepare('SELECT user_id FROM uploaded_media WHERE filename = ?').get(filename);
        if (!owner || String(owner.user_id) !== String(req.userId)) {
            return res.status(404).json({ error: 'File not found' });
        }
        const isReferencedByFeedback = db.prepare('SELECT id FROM feedback_files WHERE filename = ? LIMIT 1').get(filename);
        const isReferencedByReminder = db.prepare('SELECT images FROM reminders').all().some(row =>
            safeJsonParse(row.images, []).some(item => item && item.filename === filename)
        );
        if (isReferencedByFeedback || isReferencedByReminder) {
            return res.status(409).json({ error: 'Файл уже прикреплён' });
        }
        cleanupUnreferencedUploadedMedia([filename]);
        const remainingOwner = db.prepare('SELECT filename FROM uploaded_media WHERE filename = ?').get(filename);
        if (remainingOwner) return res.status(409).json({ error: 'Не удалось удалить временный файл' });
        return res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete recipient feedback attachment:', error.message);
        return res.status(500).json({ error: 'Не удалось удалить файл' });
    }
});

router.get('/:id/feedback', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid reminder id' });
        const reminder = db.prepare('SELECT id, user_id, recipients, feedback_options, feedback_enabled, feedback_allow_files, repeat_type FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
        if (!reminder) return res.status(404).json({ error: 'Reminder not found' });

        const feedbackEnabled = Boolean(reminder.feedback_enabled) && reminder.repeat_type === 'Никогда';
        const submissions = feedbackEnabled
            ? db.prepare('SELECT id, chat_id, recipient_name, answers, created_at FROM feedback_submissions WHERE reminder_id = ? ORDER BY created_at DESC').all(id)
            : [];
        const participants = db.prepare('SELECT chat_id, user_id, name FROM participants WHERE teacher_id = ?').all(req.userId);
        const participantByIdentity = new Map();
        participants.forEach(participant => {
            if (participant.chat_id !== null && participant.chat_id !== undefined) {
                participantByIdentity.set(String(participant.chat_id), participant);
            }
            if (participant.user_id !== null && participant.user_id !== undefined) {
                participantByIdentity.set(String(participant.user_id), participant);
            }
        });
        const recipients = feedbackEnabled ? getTargetChatIds(req.userId, safeJsonParse(reminder.recipients, [])) : [];
        const options = feedbackEnabled
            ? safeJsonParse(reminder.feedback_options, []).filter(item => typeof item === 'string' && item.trim()).map(option => {
                const count = submissions.filter(row => safeJsonParse(row.answers, {}).choice === option).length;
                return { option, count, percent: recipients.length ? Math.round(count / recipients.length * 100) : 0 };
            })
            : [];
        const files = submissions.map(row => ({
            chat_id: row.chat_id,
            files: db.prepare('SELECT filename, name, size, mime_type FROM feedback_files WHERE submission_id = ? ORDER BY id').all(row.id)
                .map(file => ({ ...file, download_url: '/api/reminders/' + id + '/feedback/files/' + encodeURIComponent(file.filename) }))
        })).filter(row => row.files.length);
        const questions = db.prepare('SELECT id, chat_id, recipient_name, question, answer, created_at, answered_at FROM recipient_questions WHERE reminder_id = ? ORDER BY created_at DESC, id DESC')
            .all(id)
            .map(row => ({
                id: row.id,
                chat_id: row.chat_id,
                recipient_name: row.recipient_name || participantByIdentity.get(String(row.chat_id))?.name || 'Получатель',
                question: row.question,
                answer: row.answer || '',
                created_at: row.created_at,
                answered_at: row.answered_at
            }));

        res.json({
            reminder_id: id,
            feedback_enabled: feedbackEnabled,
            questions,
            latest_submission_id: submissions.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
            latest_question_id: questions.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
            total_recipients: recipients.length,
            responded: submissions.length,
            response_percent: recipients.length ? Math.round(submissions.length / recipients.length * 100) : 0,
            feedback_allow_files: feedbackEnabled && Boolean(reminder.feedback_allow_files),
            file_percent: recipients.length ? Math.round(files.length / recipients.length * 100) : 0,
            options,
            submissions: submissions.map(row => {
                const participant = participantByIdentity.get(String(row.chat_id));
                return {
                    chat_id: row.chat_id,
                    name: row.recipient_name || participant?.name || '',
                    answers: safeJsonParse(row.answers, {}),
                    created_at: row.created_at
                };
            }),
            files
        });
    } catch (error) {
        console.error('Failed to load feedback:', error.message);
        res.status(500).json({ error: 'Не удалось загрузить обратную связь' });
    }
});

router.post('/:id/questions/read', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid reminder id' });
        const reminder = db.prepare('SELECT id FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
        if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
        const lastSeenQuestionId = Number(req.body?.last_seen_question_id);
        if (!Number.isSafeInteger(lastSeenQuestionId) || lastSeenQuestionId < 0) {
            return res.status(400).json({ error: 'Invalid question read position' });
        }
        const latestQuestionId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM recipient_questions WHERE reminder_id = ?').get(id).id;
        if (lastSeenQuestionId > latestQuestionId) return res.status(400).json({ error: 'Question read position is out of range' });
        db.prepare(`
            INSERT INTO recipient_question_views (user_id, reminder_id, last_seen_question_id)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, reminder_id) DO UPDATE SET
                last_seen_question_id = MAX(recipient_question_views.last_seen_question_id, excluded.last_seen_question_id),
                updated_at = CURRENT_TIMESTAMP
        `).run(String(req.userId), id, lastSeenQuestionId);
        return res.json({ success: true });
    } catch (error) {
        console.error('Failed to mark recipient questions as read:', error.message);
        return res.status(500).json({ error: 'Не удалось отметить вопросы просмотренными' });
    }
});

router.post('/:id/questions/:questionId/answer', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const questionId = Number(req.params.questionId);
        const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim().slice(0, 1000) : '';
        if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(questionId) || questionId <= 0) {
            return res.status(400).json({ error: 'Invalid question id' });
        }
        if (!answer) return res.status(400).json({ error: 'Введите ответ' });
        const reminder = db.prepare('SELECT id FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
        if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
        const question = db.prepare('SELECT id, chat_id, recipient_user_id, question, answer FROM recipient_questions WHERE id = ? AND reminder_id = ?')
            .get(questionId, id);
        if (!question) return res.status(404).json({ error: 'Вопрос не найден' });
        if (question.answer) return res.status(409).json({ error: 'На этот вопрос уже ответили' });

        const sent = await sendQuickReplyMessage(
            id,
            question.chat_id,
            question.recipient_user_id,
            'Ответ на ваш вопрос:\n' + answer
        );
        if (!sent) return res.status(502).json({ error: 'Не удалось отправить сообщение получателю' });

        const updated = db.prepare("UPDATE recipient_questions SET answer = ?, answered_at = CURRENT_TIMESTAMP WHERE id = ? AND reminder_id = ? AND answer = ''")
            .run(answer, questionId, id);
        if (!updated.changes) return res.status(409).json({ error: 'На этот вопрос уже ответили' });
        return res.json({ success: true });
    } catch (error) {
        console.error('Failed to answer recipient question:', error.message);
        return res.status(500).json({ error: 'Не удалось отправить ответ' });
    }
});

router.delete('/:id/questions/:questionId', (req, res) => {
    try {
        const id = Number(req.params.id);
        const questionId = Number(req.params.questionId);
        if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(questionId) || questionId <= 0) {
            return res.status(400).json({ error: 'Invalid question id' });
        }
        const reminder = db.prepare('SELECT id FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
        if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
        const deleted = db.prepare('DELETE FROM recipient_questions WHERE id = ? AND reminder_id = ?').run(questionId, id);
        if (!deleted.changes) return res.status(404).json({ error: 'Вопрос не найден' });
        return res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete recipient question:', error.message);
        return res.status(500).json({ error: 'Не удалось удалить вопрос' });
    }
});
router.post('/:id/feedback/read', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid reminder id' });
        const reminder = db.prepare('SELECT id FROM reminders WHERE id = ? AND user_id = ? AND feedback_enabled = 1').get(id, req.userId);
        if (!reminder) return res.status(404).json({ error: 'Feedback is unavailable' });

        const lastSeenSubmissionId = Number(req.body?.last_seen_submission_id);
        if (!Number.isSafeInteger(lastSeenSubmissionId) || lastSeenSubmissionId < 0) {
            return res.status(400).json({ error: 'Invalid feedback read position' });
        }
        const latestSubmissionId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM feedback_submissions WHERE reminder_id = ?')
            .get(id).id;
        if (lastSeenSubmissionId > latestSubmissionId) {
            return res.status(400).json({ error: 'Feedback read position is out of range' });
        }

        db.prepare(`
            INSERT INTO feedback_views (user_id, reminder_id, last_seen_submission_id)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, reminder_id) DO UPDATE SET
                last_seen_submission_id = MAX(feedback_views.last_seen_submission_id, excluded.last_seen_submission_id),
                updated_at = CURRENT_TIMESTAMP
        `).run(String(req.userId), id, lastSeenSubmissionId);

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to mark feedback as read:', error.message);
        res.status(500).json({ error: 'Не удалось отметить обратную связь просмотренной' });
    }
});

router.get('/:id/feedback/export', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid reminder id' });
        const reminder = db.prepare('SELECT id, title, recipients, message_ids, feedback_options, feedback_enabled, feedback_allow_files, repeat_type FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
        if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
        if (!reminder.feedback_enabled || reminder.repeat_type !== 'Никогда') {
            return res.status(404).json({ error: 'Экспорт ответов недоступен для этого напоминания' });
        }

        const selectedRecipients = safeJsonParse(reminder.recipients, []);
        const sentMessageIds = safeJsonParse(reminder.message_ids, {});
        const storedRecipientIds = sentMessageIds && typeof sentMessageIds === 'object' && !Array.isArray(sentMessageIds)
            ? Object.keys(sentMessageIds).filter(chatId => chatId)
            : [];
        const recipientIds = storedRecipientIds.length
            ? storedRecipientIds
            : getTargetChatIds(req.userId, Array.isArray(selectedRecipients) ? selectedRecipients : []);
        const submissions = db.prepare('SELECT chat_id, recipient_name, answers, created_at FROM feedback_submissions WHERE reminder_id = ? ORDER BY created_at, id').all(id);
        const fileRows = db.prepare('SELECT s.chat_id, f.name FROM feedback_files f JOIN feedback_submissions s ON s.id = f.submission_id WHERE s.reminder_id = ? ORDER BY f.id').all(id);
        const participants = db.prepare('SELECT chat_id, user_id, name FROM participants WHERE teacher_id = ?').all(req.userId);
        const participantByIdentity = new Map();
        participants.forEach(participant => {
            if (participant.chat_id !== null && participant.chat_id !== undefined) participantByIdentity.set(String(participant.chat_id), participant);
            if (participant.user_id !== null && participant.user_id !== undefined) participantByIdentity.set(String(participant.user_id), participant);
        });

        const submissionByChatId = new Map(submissions.map(row => [String(row.chat_id), row]));
        const filesByChatId = new Map();
        fileRows.forEach(file => {
            const key = String(file.chat_id);
            if (!filesByChatId.has(key)) filesByChatId.set(key, []);
            filesByChatId.get(key).push(file.name);
        });
        const allRecipientIds = [...new Set([
            ...recipientIds.map(String),
            ...submissions.map(row => String(row.chat_id)),
            ...fileRows.map(row => String(row.chat_id))
        ])];

        const answerRows = [[
            'Получатель',
            'ID MAX',
            'Статус ответа',
            'Выбранный вариант',
            'Текстовый ответ',
            'Прикрепил файл',
            'Названия файлов',
            'Количество файлов',
            'Дата ответа'
        ]];
        allRecipientIds.forEach(chatId => {
            const submission = submissionByChatId.get(chatId);
            const participant = participantByIdentity.get(chatId);
            const name = submission?.recipient_name || participant?.name || (chatId === String(req.userId) ? 'Вы' : 'Получатель');
            const answers = submission ? safeJsonParse(submission.answers, {}) : {};
            const recipientFiles = filesByChatId.get(chatId) || [];
            const hasFiles = recipientFiles.length > 0;
            const fileStatus = hasFiles ? 'Да' : (reminder.feedback_allow_files ? 'Нет' : 'Не запрашивались');
            answerRows.push([
                name,
                chatId,
                submission ? 'Ответил' : 'Не ответил',
                typeof answers.choice === 'string' ? answers.choice : '',
                typeof answers.text === 'string' ? answers.text : (typeof answers.answer === 'string' ? answers.answer : ''),
                fileStatus,
                recipientFiles.join('; '),
                recipientFiles.length,
                submission?.created_at || ''
            ]);
        });

        const totalRecipients = allRecipientIds.length;
        const respondedIds = new Set(submissions.map(row => String(row.chat_id)));
        const responded = respondedIds.size;
        const attachedRecipientIds = new Set(fileRows.map(row => String(row.chat_id)));
        const attached = [...attachedRecipientIds].filter(chatId => allRecipientIds.includes(chatId)).length;
        const notAttached = Math.max(0, totalRecipients - attached);
        const responsePercent = totalRecipients ? Math.round(responded / totalRecipients * 1000) / 10 : 0;
        const filePercent = totalRecipients ? Math.round(attached / totalRecipients * 1000) / 10 : 0;

        const statisticsRows = [
            ['Показатель', 'Значение'],
            ['Напоминание', reminder.title || ('Напоминание #' + id)],
            ['Всего получателей', totalRecipients],
            ['Ответили', responded],
            ['Не ответили', Math.max(0, totalRecipients - responded)],
            ['Доля ответивших', responsePercent + '%'],
            ['Разрешено прикреплять файлы', reminder.feedback_allow_files ? 'Да' : 'Нет'],
            ['Получателей с файлами', attached],
            ['Получателей без файлов', reminder.feedback_allow_files || attached > 0 ? notAttached : 'Не применимо'],
            ['Всего прикреплённых файлов', fileRows.length],
            ['Доля получателей с файлами', reminder.feedback_allow_files || attached > 0 ? filePercent + '%' : 'Не применимо']
        ];

        const configuredOptions = safeJsonParse(reminder.feedback_options, []);
        const optionMap = new Map();
        (Array.isArray(configuredOptions) ? configuredOptions : []).forEach(option => {
            if (typeof option !== 'string' || !option.trim()) return;
            const key = option.trim().toLocaleLowerCase('ru');
            if (!optionMap.has(key)) optionMap.set(key, option.trim());
        });
        submissions.forEach(row => {
            const answers = safeJsonParse(row.answers, {});
            if (typeof answers.choice !== 'string' || !answers.choice.trim()) return;
            const option = answers.choice.trim();
            const key = option.toLocaleLowerCase('ru');
            if (!optionMap.has(key)) optionMap.set(key, option);
        });
        const optionCounts = new Map();
        submissions.forEach(row => {
            const answers = safeJsonParse(row.answers, {});
            if (typeof answers.choice !== 'string' || !answers.choice.trim()) return;
            const key = answers.choice.trim().toLocaleLowerCase('ru');
            optionCounts.set(key, (optionCounts.get(key) || 0) + 1);
        });
        const optionRows = [['Вариант ответа', 'Количество', '% от всех получателей', '% от ответивших']];
        optionMap.forEach((option, key) => {
            const count = optionCounts.get(key) || 0;
            const shareOfRecipients = totalRecipients ? Math.round(count / totalRecipients * 1000) / 10 : 0;
            const shareOfRespondents = responded ? Math.round(count / responded * 1000) / 10 : 0;
            optionRows.push([option, count, shareOfRecipients + '%', shareOfRespondents + '%']);
        });
        const selectedOptionTotal = [...optionCounts.values()].reduce((sum, count) => sum + count, 0);
        const noChoiceCount = Math.max(0, responded - selectedOptionTotal);
        if (noChoiceCount > 0) {
            const noChoiceRecipientsPercent = totalRecipients ? Math.round(noChoiceCount / totalRecipients * 1000) / 10 : 0;
            const noChoiceRespondentsPercent = responded ? Math.round(noChoiceCount / responded * 1000) / 10 : 0;
            optionRows.push(['Ответили без выбора варианта', noChoiceCount, noChoiceRecipientsPercent + '%', noChoiceRespondentsPercent + '%']);
        }
        if (!optionMap.size && noChoiceCount === 0) optionRows.push(['Варианты ответа не настроены', 0, '0%', '0%']);

        const workbook = await createWorkbook([
            { name: 'Ответы', rows: answerRows },
            { name: 'Статистика', rows: statisticsRows },
            { name: 'Варианты ответов', rows: optionRows }
        ]);
        const safeTitle = String(reminder.title || 'feedback')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .trim()
            .slice(0, 70) || 'feedback';
        const fileName = 'Ответы - ' + safeTitle + '.xlsx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="feedback-' + id + '.xlsx"; filename*=UTF-8\'\'' + encodeURIComponent(fileName));
        res.setHeader('Content-Length', workbook.length);
        return res.send(workbook);
    } catch (error) {
        console.error('Failed to export feedback workbook:', error.message);
        return res.status(500).json({ error: 'Не удалось экспортировать ответы' });
    }
});

router.get('/:id/feedback/files/:filename', (req, res) => {
    try {
        const id = Number(req.params.id);
        const filename = String(req.params.filename || '');
        const reminder = db.prepare('SELECT user_id FROM reminders WHERE id = ? AND user_id = ?').get(id, req.userId);
        const file = db.prepare('SELECT f.name, f.mime_type FROM feedback_files f JOIN feedback_submissions s ON s.id = f.submission_id WHERE s.reminder_id = ? AND f.filename = ?').get(id, filename);
        if (!reminder || !file || !/^file_[a-f0-9]{32}\.[a-z0-9]+$/i.test(filename)) return res.status(404).json({ error: 'File not found' });
        const filePath = path.join(__dirname, '..', 'data', 'uploads', filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.type(file.mime_type || 'application/octet-stream');
        return res.download(filePath, file.name);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось скачать файл' });
    }
});

router.get('/public/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid reminder id' });
        }

        const reminder = db.prepare('SELECT user_id, title, description, sender_name, quick_replies, feedback_questions, feedback_options, images, message_ids, feedback_enabled, feedback_allow_files, repeat_type FROM reminders WHERE id = ?').get(id);
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
        const recipientQuestions = db.prepare('SELECT id, question, answer FROM recipient_questions WHERE reminder_id = ? ORDER BY created_at, id').all(id);
        const savedImages = safeJsonParse(reminder.images, []);
        const validImages = sanitizeUploadedMedia(savedImages, reminder.user_id);
        const publicImages = Array.isArray(validImages)
            ? validImages.map(({ filename, type, name, size, mime_type, width, height }) => ({
                url: '/api/reminders/public/' + id + '/media/' + encodeURIComponent(filename),
                download_url: type === 'file'
                    ? PUBLIC_BASE_URL + '/api/media-download/' + createRecipientDownloadToken(id, filename, req.userId)
                    : null,
                type,
                name,
                size,
                mime_type,
                width,
                height
            }))
            : [];

        const feedbackSubmission = db.prepare('SELECT id, answers, created_at FROM feedback_submissions WHERE reminder_id = ? AND chat_id = ?')
            .get(id, chatId);
        const feedbackFiles = feedbackSubmission
            ? db.prepare('SELECT filename, name, size, mime_type FROM feedback_files WHERE submission_id = ? ORDER BY id')
                .all(feedbackSubmission.id)
                .map(file => ({
                    ...file,
                    download_url: '/api/reminders/public/' + id + '/feedback/files/' + encodeURIComponent(file.filename)
                }))
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
            quick_replies: publicReplies,
            questions: recipientQuestions.map(row => ({ id: row.id, question: row.question, answer: row.answer || '' })),
            feedback_options: sanitizeFeedbackOptions(safeJsonParse(reminder.feedback_options, [])) || [],
            feedback_enabled: Boolean(reminder.feedback_enabled) && reminder.repeat_type === 'Никогда',
            feedback_allow_files: Boolean(reminder.feedback_allow_files),
            feedback_submission: feedbackSubmission ? {
                answers: safeJsonParse(feedbackSubmission.answers, {}),
                created_at: feedbackSubmission.created_at,
                files: feedbackFiles
            } : null
        });
    } catch (error) {
        console.error('Failed to fetch recipient reminder:', error.message);
        return res.status(500).json({ error: 'Failed to fetch reminder' });
    }
});

router.get('/', (req, res) => {
    try {
        const pruneReminderHistory = db.transaction(userId => {
            const oldSent = db.prepare("SELECT id, images FROM reminders WHERE user_id = ? AND status = 'sent' ORDER BY julianday(COALESCE(sent_at, created_at)) DESC, id DESC LIMIT -1 OFFSET 5").all(userId);
            const oldScheduled = db.prepare("SELECT id, images FROM reminders WHERE user_id = ? AND status = 'scheduled' ORDER BY CASE WHEN scheduled_time IS NULL THEN 1 ELSE 0 END, scheduled_time ASC, id ASC LIMIT -1 OFFSET 5").all(userId);
            const removed = oldSent.concat(oldScheduled);
            if (!removed.length) return [];

            const ids = removed.map(row => row.id);
            const placeholders = ids.map(() => '?').join(',');
            const filenames = new Set();
            removed.forEach(row => {
                safeJsonParse(row.images, []).forEach(item => {
                    if (item && typeof item.filename === 'string') filenames.add(item.filename);
                });
            });
            db.prepare('SELECT f.filename FROM feedback_files f JOIN feedback_submissions s ON s.id = f.submission_id WHERE s.reminder_id IN (' + placeholders + ')')
                .all(...ids)
                .forEach(row => filenames.add(row.filename));

            db.prepare('DELETE FROM responses WHERE reminder_id IN (' + placeholders + ')').run(...ids);
            db.prepare('DELETE FROM recipient_download_tickets WHERE reminder_id IN (' + placeholders + ')').run(...ids);
            db.prepare('DELETE FROM feedback_files WHERE submission_id IN (SELECT id FROM feedback_submissions WHERE reminder_id IN (' + placeholders + '))').run(...ids);
            db.prepare('DELETE FROM feedback_submissions WHERE reminder_id IN (' + placeholders + ')').run(...ids);
            db.prepare('DELETE FROM reminders WHERE user_id = ? AND id IN (' + placeholders + ')').run(userId, ...ids);

            return [...filenames];
        });
        cleanupUnreferencedUploadedMedia(pruneReminderHistory(req.userId));

        const rows = db.prepare("SELECT reminders.*, CASE WHEN reminders.feedback_enabled = 1 THEN (SELECT COUNT(*) FROM feedback_submissions fs WHERE fs.reminder_id = reminders.id AND fs.id > COALESCE((SELECT fv.last_seen_submission_id FROM feedback_views fv WHERE fv.reminder_id = reminders.id AND fv.user_id = reminders.user_id), 0)) ELSE 0 END AS feedback_unread_count, (SELECT COUNT(*) FROM recipient_questions rq WHERE rq.reminder_id = reminders.id AND rq.id > COALESCE((SELECT qv.last_seen_question_id FROM recipient_question_views qv WHERE qv.reminder_id = reminders.id AND qv.user_id = reminders.user_id), 0)) AS question_unread_count FROM reminders WHERE user_id = ? ORDER BY id DESC").all(req.userId);
        const parsed = rows.map(r => ({
            ...r,
            recipients: safeJsonParse(r.recipients, []),
            quick_replies: safeJsonParse(r.quick_replies, []),
            feedback_questions: safeJsonParse(r.feedback_questions, []),
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
    const match = /^file_[a-f0-9]{32}\.[a-z0-9]{1,16}$/i.exec(filename)
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
        const feedbackFilenames = db.prepare('SELECT f.filename FROM feedback_files f JOIN feedback_submissions s ON s.id = f.submission_id WHERE s.reminder_id = ?')
            .all(id)
            .map(file => file.filename);
        db.transaction(() => {
            db.prepare('DELETE FROM responses WHERE reminder_id = ?').run(id);
            db.prepare('DELETE FROM recipient_download_tickets WHERE reminder_id = ?').run(id);
            db.prepare('DELETE FROM feedback_files WHERE submission_id IN (SELECT id FROM feedback_submissions WHERE reminder_id = ?)').run(id);
            db.prepare('DELETE FROM feedback_submissions WHERE reminder_id = ?').run(id);
            db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, req.userId);
        })();
        const reminderFilenames = safeJsonParse(reminder.images, [])
            .map(item => item && item.filename)
            .filter(Boolean);
        cleanupUnreferencedUploadedMedia([...reminderFilenames, ...feedbackFilenames]);
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
            images,
            feedback_enabled,
            feedback_allow_files,
            feedback_questions,
            feedback_options
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
        const cleanFeedbackEnabled = cleanRepeatType === 'Никогда' && feedback_enabled === true;
        const cleanFeedbackAllowFiles = cleanFeedbackEnabled && feedback_allow_files === true;
        const validFeedbackOptions = sanitizeFeedbackOptions(feedback_options);
        if (!validFeedbackOptions) return res.status(400).json({ error: 'feedback_options must contain at most 20 options' });
        const cleanFeedbackOptions = cleanFeedbackEnabled ? validFeedbackOptions : [];
        const validImages = sanitizeUploadedMedia(images, req.userId);
        if (!validImages) {
            return res.status(400).json({ error: 'Вложения должны быть загружены через приложение. Максимум 3 фото и 3 документа по 10 МБ' });
        }

        const stmt = db.prepare(`
            INSERT INTO reminders (
                user_id, title, description, sender_name, send_now, scheduled_time, repeat_type, repeat_time, recipients, quick_replies, feedback_questions, feedback_options, images, feedback_enabled, feedback_allow_files, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            JSON.stringify([]),
            JSON.stringify(cleanFeedbackOptions),
            JSON.stringify(validImages),
            cleanFeedbackEnabled ? 1 : 0,
            cleanFeedbackAllowFiles ? 1 : 0,
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
            return res.status(400).json({ error: 'Вложения должны быть загружены через приложение. Максимум 3 фото и 3 документа по 10 МБ' });
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

router.handleRecipientMediaDownload = handleRecipientMediaDownload;

module.exports = router;
