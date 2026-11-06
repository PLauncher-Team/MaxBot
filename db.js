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
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        quick_replies TEXT NOT NULL,
        feedback_options TEXT NOT NULL DEFAULT '[]',
        feedback_enabled INTEGER NOT NULL DEFAULT 0,
        feedback_allow_files INTEGER NOT NULL DEFAULT 0,
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
        sender_name TEXT,
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
        feedback_enabled INTEGER NOT NULL DEFAULT 0,
        feedback_allow_files INTEGER NOT NULL DEFAULT 0,
        feedback_questions TEXT NOT NULL DEFAULT '[]',
        feedback_options TEXT NOT NULL DEFAULT '[]',
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

    CREATE TABLE IF NOT EXISTS participant_groups (
        participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (participant_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reminder_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feedback_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL,
        recipient_name TEXT NOT NULL DEFAULT '',
        answers TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(reminder_id, chat_id)
    );

    CREATE TABLE IF NOT EXISTS feedback_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL REFERENCES feedback_submissions(id) ON DELETE CASCADE,
        filename TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feedback_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
        last_seen_submission_id INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, reminder_id)
    );

    CREATE TABLE IF NOT EXISTS uploaded_media (
        filename TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recipient_download_tickets (
        token_hash TEXT PRIMARY KEY,
        reminder_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_participants_teacher_user_id
        ON participants(teacher_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_participant_groups_group_id
        ON participant_groups(group_id);
    CREATE INDEX IF NOT EXISTS idx_participant_groups_participant_id
        ON participant_groups(participant_id);

    CREATE INDEX IF NOT EXISTS idx_recipient_download_tickets_lookup
        ON recipient_download_tickets(reminder_id, filename, user_id);
    CREATE INDEX IF NOT EXISTS idx_recipient_download_tickets_expires_at
        ON recipient_download_tickets(expires_at);
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_submissions_reminder ON feedback_submissions(reminder_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_files_submission ON feedback_files(submission_id)');

module.exports = db;

db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_views_reminder_user ON feedback_views(reminder_id, user_id)');
