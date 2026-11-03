const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        quick_replies TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS template_seed_state (
        user_id TEXT PRIMARY KEY,
        initialized_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        send_now INTEGER NOT NULL,
        scheduled_time TEXT,
        repeat_type TEXT,
        repeat_time TEXT,
        recipients TEXT,
        quick_replies TEXT,
        images TEXT,
        pending_recipients TEXT,
        sent_at TEXT,
        message_ids TEXT,
        reply_message_ids TEXT,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        unique_id TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        group_id INTEGER,
        chat_id TEXT NOT NULL,
        user_id TEXT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reminder_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);


const participantColumns = new Set(
    db.prepare('PRAGMA table_info(participants)').all().map(column => column.name)
);
if (!participantColumns.has('user_id')) {
    db.exec('ALTER TABLE participants ADD COLUMN user_id TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_participants_teacher_user_id ON participants(teacher_id, user_id)');

const reminderColumns = new Set(
    db.prepare('PRAGMA table_info(reminders)').all().map(column => column.name)
);
const reminderColumnMigrations = {
    pending_recipients: 'TEXT',
    sent_at: 'TEXT',
    message_ids: 'TEXT',
    reply_message_ids: 'TEXT'
};
for (const [columnName, columnType] of Object.entries(reminderColumnMigrations)) {
    if (!reminderColumns.has(columnName)) {
        db.exec(`ALTER TABLE reminders ADD COLUMN ${columnName} ${columnType}`);
    }
}

// Multiple groups per participant. Existing single-group assignments are migrated once.
db.pragma('foreign_keys = ON');
db.exec(`
    CREATE TABLE IF NOT EXISTS participant_groups (
        participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (participant_id, group_id)
    );

    CREATE INDEX IF NOT EXISTS idx_participant_groups_group_id
        ON participant_groups(group_id);
    CREATE INDEX IF NOT EXISTS idx_participant_groups_participant_id
        ON participant_groups(participant_id);

    INSERT OR IGNORE INTO participant_groups (participant_id, group_id)
    SELECT p.id, p.group_id
    FROM participants p
    INNER JOIN groups g ON g.id = p.group_id
    WHERE p.group_id IS NOT NULL;
`);

module.exports = db;
