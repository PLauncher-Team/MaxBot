const db = require('./db');
const { sendBroadcastMessage } = require('./bot');

function safeJsonParse(data, fallback = []) {
    if (!data || typeof data !== 'string') return fallback;
    try {
        return JSON.parse(data);
    } catch (e) {
        return fallback;
    }
}

function getMoscowDateTimeString() {
    const mskDate = new Date(Date.now() + 3 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const year = mskDate.getUTCFullYear();
    const month = pad(mskDate.getUTCMonth() + 1);
    const day = pad(mskDate.getUTCDate());
    const hours = pad(mskDate.getUTCHours());
    const mins = pad(mskDate.getUTCMinutes());
    return `${year}-${month}-${day}T${hours}:${mins}`;
}

function calculateNextScheduledTime(currentStr, repeatType) {
    const d = new Date(currentStr);
    if (isNaN(d.getTime())) return currentStr;

    if (repeatType === 'Каждый день') {
        d.setDate(d.getDate() + 1);
    } else if (repeatType === 'Каждую неделю') {
        d.setDate(d.getDate() + 7);
    } else if (repeatType === 'Каждый месяц') {
        d.setMonth(d.getMonth() + 1);
    }

    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function checkScheduledReminders() {
    try {
        const mskStr = getMoscowDateTimeString();
        const dueReminders = db.prepare(`
            SELECT * FROM reminders
            WHERE status = 'scheduled' AND scheduled_time IS NOT NULL AND scheduled_time <= ?
        `).all(mskStr);

        for (const r of dueReminders) {
            const validRecipients = safeJsonParse(r.recipients, []);
            const validReplies = safeJsonParse(r.quick_replies, []);
            const validImages = safeJsonParse(r.images, []);
            let targetChatIds = [];

            if (validRecipients.includes('Себе')) {
                targetChatIds.push(r.user_id);
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
                const rows = db.prepare(query).all(r.user_id, ...groupNames);
                rows.forEach(row => {
                    if (!targetChatIds.includes(row.chat_id)) {
                        targetChatIds.push(row.chat_id);
                    }
                });
            }

            if (targetChatIds.length > 0) {
                const fullText = r.title + (r.description ? '\n\n' + r.description : '');
                sendBroadcastMessage(r.id, targetChatIds, fullText, validReplies, validImages);
            }

            if (r.repeat_type && r.repeat_type !== 'Никогда') {
                const nextTime = calculateNextScheduledTime(r.scheduled_time, r.repeat_type);
                db.prepare("UPDATE reminders SET scheduled_time = ? WHERE id = ?").run(nextTime, r.id);
            } else {
                db.prepare("UPDATE reminders SET status = 'sent' WHERE id = ?").run(r.id);
            }
        }
    } catch (e) {
        console.error('Scheduler error:', e);
    }
}

function startScheduler() {
    setInterval(checkScheduledReminders, 15000);
}

module.exports = {
    startScheduler,
    getMoscowDateTimeString
};
