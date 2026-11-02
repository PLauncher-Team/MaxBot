const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { authMiddleware } = require('./auth');
const { botInstance } = require('./bot');
const { startScheduler } = require('./scheduler');

const templatesRouter = require('./routes/templates');
const groupsRouter = require('./routes/groups');
const participantsRouter = require('./routes/participants');
const remindersRouter = require('./routes/reminders');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-User-Id', 'X-Webapp-Init-Data']
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '20mb' }));

app.get('/api/uploads/:filename', (req, res) => {
    try {
        const filename = path.basename(req.params.filename);
        const filePath = path.join(__dirname, 'data', 'uploads', filename);
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (e) {
        console.error('SERVE UPLOAD ERROR:', e);
        res.status(500).json({ error: 'Failed to serve file' });
    }
});

app.use('/api', authMiddleware);

app.use('/api/templates', templatesRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/participants', participantsRouter);
app.use('/api/reminders', remindersRouter);

app.post('/api/join-group', (req, res) => {
    try {
        const { unique_id, user_name } = req.body;
        if (!unique_id || typeof unique_id !== 'string') {
            return res.status(400).json({ error: 'Unique group ID required' });
        }
        const group = db.prepare('SELECT * FROM groups WHERE unique_id = ?').get(unique_id.trim());
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const cleanName = typeof user_name === 'string' && user_name.trim() ? user_name.trim().slice(0, 100) : 'Участник ' + req.userId;
        const existing = db.prepare('SELECT id FROM participants WHERE teacher_id = ? AND chat_id = ?').get(group.user_id, req.userId);
        if (existing) {
            db.prepare('UPDATE participants SET group_id = ?, name = ? WHERE id = ?').run(group.id, cleanName, existing.id);
        } else {
            db.prepare('INSERT INTO participants (teacher_id, group_id, chat_id, name) VALUES (?, ?, ?, ?)').run(group.user_id, group.id, req.userId, cleanName);
        }
        res.json({ success: true, group_name: group.name });
    } catch (e) {
        res.status(500).json({ error: 'Failed to join group' });
    }
});

startScheduler();

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running on port ${PORT}`);
});
