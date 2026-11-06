const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { authMiddleware, recipientAuthMiddleware, apiRateLimit, uploadRateLimit, reminderWriteRateLimit } = require('./auth');
const { getMiniAppBotUsername } = require('./bot');
const { startScheduler } = require('./scheduler');

const templatesRouter = require('./routes/templates');
const groupsRouter = require('./routes/groups');
const participantsRouter = require('./routes/participants');
const remindersRouter = require('./routes/reminders');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
const APP_ALLOWED_ORIGINS = process.env.APP_ALLOWED_ORIGINS;

if (!PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is required');
if (!APP_ALLOWED_ORIGINS) throw new Error('APP_ALLOWED_ORIGINS is required');

const allowedOrigins = new Set(
    APP_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
);

if (allowedOrigins.size === 0) throw new Error('APP_ALLOWED_ORIGINS must contain at least one origin');

const publicMediaTypes = {
    png: 'image/png',
    jpg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    pdf: 'application/octet-stream',
    doc: 'application/octet-stream',
    docx: 'application/octet-stream',
    xls: 'application/octet-stream',
    xlsx: 'application/octet-stream',
    ppt: 'application/octet-stream',
    pptx: 'application/octet-stream',
    txt: 'application/octet-stream',
    csv: 'application/octet-stream',
    rtf: 'application/octet-stream',
    md: 'application/octet-stream',
    odt: 'application/octet-stream',
    ods: 'application/octet-stream',
    odp: 'application/octet-stream',
    zip: 'application/octet-stream'
};

app.disable('x-powered-by');

app.use(cors({
    origin(origin, callback) {
        // Same-origin and non-browser requests do not send an Origin header.
        if (!origin || allowedOrigins.has(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Webapp-Init-Data'],
    optionsSuccessStatus: 204
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    next();
});

// Public, capability-style media URLs are needed by MAX to load attachments.
// Only generated image/video filenames are served; active formats such as SVG/HTML are forbidden.
app.get('/api/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const match = /^(img|vid|file)_[a-f0-9]{16}(?:[a-f0-9]{16})?\.(png|jpg|gif|webp|mp4|mov|webm|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf|md|odt|ods|odp|zip)$/i.exec(filename || '');
    if (!match) {
        return res.status(404).json({ error: 'File not found' });
    }

    const extension = match[2].toLowerCase();
    const filePath = path.join(__dirname, 'data', 'uploads', filename);
    try {
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return res.status(404).json({ error: 'File not found' });
        }

        const isFile = match[1].toLowerCase() === 'file';
        const requestedName = String(req.query.name || filename).replace(/[\r\n"\\]/g, '_').slice(0, 120);
        const encodedName = encodeURIComponent(requestedName).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
        res.setHeader('Content-Type', publicMediaTypes[extension] || 'application/octet-stream');
        res.setHeader('Content-Disposition', isFile
            ? `attachment; filename="attachment.${extension}"; filename*=UTF-8''${encodedName}`
            : `inline; filename="${filename}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        return res.sendFile(filePath);
    } catch (error) {
        console.error('Failed to serve uploaded media:', error.message);
        return res.status(500).json({ error: 'Failed to serve file' });
    }
});

// Authenticate before parsing request bodies so unauthenticated clients cannot make the
// JSON parser process large payloads. No client-supplied user ID is trusted.
app.get('/api/media-download/:token', remindersRouter.handleRecipientMediaDownload);

app.use('/api', (req, res, next) => {
    const authenticate = req.path.startsWith('/reminders/public/')
        ? recipientAuthMiddleware
        : authMiddleware;
    return authenticate(req, res, () => apiRateLimit(req, res, next));
});
app.use('/api/reminders/upload-media', uploadRateLimit);
app.use('/api/reminders/upload-image', uploadRateLimit);
app.use('/api/reminders/upload-file', uploadRateLimit);
app.use('/api/reminders', (req, res, next) => {
    if ((req.method === 'POST' && (req.path === '/' || req.path === '' || req.path.startsWith('/public/'))) || req.method === 'PUT') {
        return reminderWriteRateLimit(req, res, next);
    }
    return next();
});
app.use(express.json({ limit: '20mb', strict: true }));

app.get('/api/bot-info', async (req, res) => {
    try {
        const username = await getMiniAppBotUsername();
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.json({ username });
    } catch (error) {
        console.error('Failed to get MAX bot info:', error.message);
        res.status(503).json({ error: 'MAX bot information is unavailable' });
    }
});

app.use('/api/templates', templatesRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/participants', participantsRouter);
app.use('/api/reminders', remindersRouter);
app.get('/media-download/:token', remindersRouter.handleRecipientMediaDownload);

app.post('/api/join-group', (req, res) => {
    try {
        const { unique_id, user_name } = req.body || {};
        if (typeof unique_id !== 'string' || !/^g_[a-f0-9]{12}$/i.test(unique_id.trim())) {
            return res.status(400).json({ error: 'Invalid group invitation' });
        }

        const group = db.prepare('SELECT * FROM groups WHERE unique_id = ?').get(unique_id.trim());
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const cleanName = typeof user_name === 'string' && user_name.trim()
            ? user_name.trim().slice(0, 100)
            : 'Участник ' + req.userId;

        const joinGroup = db.transaction(() => {
            const existing = db.prepare('SELECT id FROM participants WHERE teacher_id = ? AND (chat_id = ? OR user_id = ?)')
                .get(group.user_id, req.userId, req.userId);
            let participantId;
            if (existing) {
                participantId = existing.id;
                db.prepare('UPDATE participants SET user_id = COALESCE(user_id, ?), name = ?, group_id = COALESCE(group_id, ?) WHERE id = ? AND teacher_id = ?')
                    .run(req.userId, cleanName, group.id, participantId, group.user_id);
            } else {
                const created = db.prepare('INSERT INTO participants (teacher_id, group_id, chat_id, user_id, name) VALUES (?, ?, ?, ?, ?)')
                    .run(group.user_id, group.id, req.userId, req.userId, cleanName);
                participantId = created.lastInsertRowid;
            }
            db.prepare('INSERT OR IGNORE INTO participant_groups (participant_id, group_id) VALUES (?, ?)')
                .run(participantId, group.id);
        });

        joinGroup();
        res.json({ success: true, group_name: group.name });
    } catch (error) {
        console.error('Failed to join group:', error);
        res.status(500).json({ error: 'Failed to join group' });
    }
});

// Keep malformed JSON and oversized-body errors from exposing stack traces.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && error.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body is too large' });
    }
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({ error: 'Invalid JSON body' });
    }
    console.error('Unhandled API error:', error && error.message ? error.message : 'unknown error');
    return res.status(500).json({ error: 'Internal server error' });
});

startScheduler();

app.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
});
