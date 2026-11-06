const db = require('./db');
const { sendBroadcastMessage } = require('./bot');
const { runStorageMaintenance } = require('./maintenance');

let schedulerRunning = false;

function safeJsonParse(data, fallback = []) {
    if (!data || typeof data !== 'string') return fallback;
    try {
        return JSON.parse(data);
    } catch (e) {
        return fallback;
    }
}

function parseMoscowDateTime(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
    if (!match) return null;

    const [, year, month, day, hours, minutes] = match;
    const date = new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hours),
        Number(minutes)
    ));

    return isNaN(date.getTime()) ? null : date;
}

function formatMoscowDateTime(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function getMoscowDateTimeString() {
    return formatMoscowDateTime(new Date(Date.now() + 3 * 60 * 60 * 1000));
}

function applyRepeatTime(date, repeatTime) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(repeatTime || ''));
    if (!match) return date;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return date;

    date.setUTCHours(hours, minutes, 0, 0);
    return date;
}

function addRepeatInterval(currentStr, repeatType, repeatTime) {
    const date = parseMoscowDateTime(currentStr);
    if (!date) return null;

    if (repeatType === 'Каждый день') {
        date.setUTCDate(date.getUTCDate() + 1);
        applyRepeatTime(date, repeatTime);
        return formatMoscowDateTime(date);
    }

    if (repeatType === 'Каждую неделю') {
        date.setUTCDate(date.getUTCDate() + 7);
        applyRepeatTime(date, repeatTime);
        return formatMoscowDateTime(date);
    }

    if (repeatType === 'Каждый месяц') {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        const hours = date.getUTCHours();
        const minutes = date.getUTCMinutes();
        const nextYear = year + Math.floor(month / 12);
        const nextMonth = month % 12;
        const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
        const nextDate = new Date(Date.UTC(nextYear, nextMonth, Math.min(day, lastDay), hours, minutes));
        applyRepeatTime(nextDate, repeatTime);
        return formatMoscowDateTime(nextDate);
    }

    return null;
}

function calculateNextScheduledTime(currentStr, repeatType, repeatTime, afterStr) {
    let nextTime = addRepeatInterval(currentStr, repeatType, repeatTime);
    if (!nextTime) return null;

    const threshold = afterStr || getMoscowDateTimeString();
    let attempts = 0;

    while (nextTime <= threshold && attempts < 10000) {
        nextTime = addRepeatInterval(nextTime, repeatType, repeatTime);
        if (!nextTime) return null;
        attempts++;
    }

    return nextTime;
}

function getTargetChatIds(reminder) {
    const validRecipients = safeJsonParse(reminder.recipients, []);
    const targetChatIds = [];

    if (validRecipients.includes('Себе')) {
        targetChatIds.push(String(reminder.user_id));
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
        const rows = db.prepare(query).all(reminder.user_id, ...groupNames);
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
        `).all(reminder.user_id, ...personIds);
        rows.forEach(row => {
            const chatId = String(row.chat_id);
            if (!targetChatIds.includes(chatId)) targetChatIds.push(chatId);
        });
    }
    return targetChatIds;
}

async function checkScheduledReminders() {
    if (schedulerRunning) return;
    schedulerRunning = true;

    try {
        const mskStr = getMoscowDateTimeString();
        const dueReminders = db.prepare(`
            SELECT * FROM reminders
            WHERE status = 'scheduled' AND scheduled_time IS NOT NULL AND scheduled_time <= ?
            ORDER BY scheduled_time ASC, id ASC
        `).all(mskStr);

        for (const reminder of dueReminders) {
            try {
                const targetChatIds = getTargetChatIds(reminder);
                const pendingRecipients = safeJsonParse(reminder.pending_recipients, null);
                const recipientsToSend = Array.isArray(pendingRecipients) ? pendingRecipients : targetChatIds;
                let sendResult = { sentChatIds: [], failedChatIds: [] };

                if (recipientsToSend.length > 0) {
                    sendResult = await sendBroadcastMessage(
                        reminder.id,
                        recipientsToSend,
                        reminder.title + (reminder.description ? '\n\n' + reminder.description : ''),
                        safeJsonParse(reminder.quick_replies, []),
                        safeJsonParse(reminder.images, []),
                        { name: reminder.sender_name || '', id: reminder.user_id }
                    );
                }

                const failedChatIds = Array.isArray(sendResult?.failedChatIds) ? sendResult.failedChatIds : [];

                if (Object.keys(sendResult.messageIds || {}).length > 0) {
                    db.prepare('UPDATE reminders SET sent_at = ?, message_ids = ? WHERE id = ?')
                        .run(getMoscowDateTimeString(), JSON.stringify(sendResult.messageIds), reminder.id);
                }

                if (failedChatIds.length > 0) {
                    db.prepare('UPDATE reminders SET pending_recipients = ? WHERE id = ?')
                        .run(JSON.stringify(failedChatIds), reminder.id);
                    console.error('Reminder delivery incomplete:', reminder.id, failedChatIds);
                    continue;
                }

                if (reminder.repeat_type && reminder.repeat_type !== 'Никогда') {
                    const nextTime = calculateNextScheduledTime(
                        reminder.scheduled_time,
                        reminder.repeat_type,
                        reminder.repeat_time,
                        getMoscowDateTimeString()
                    );

                    if (nextTime) {
                        db.prepare('UPDATE reminders SET scheduled_time = ?, pending_recipients = NULL WHERE id = ?')
                            .run(nextTime, reminder.id);
                    } else {
                        db.prepare("UPDATE reminders SET status = 'sent', pending_recipients = NULL WHERE id = ?")
                            .run(reminder.id);
                    }
                } else {
                    db.prepare("UPDATE reminders SET status = 'sent', pending_recipients = NULL WHERE id = ?")
                        .run(reminder.id);
                }
            } catch (reminderError) {
                console.error('Reminder processing error:', reminder.id, reminderError);
            }
        }
    } catch (e) {
        console.error('Scheduler error:', e);
    } finally {
        schedulerRunning = false;
    }
}

function startScheduler() {
    checkScheduledReminders();
    runStorageMaintenance();
    setInterval(checkScheduledReminders, 15000);
    setInterval(runStorageMaintenance, 60 * 60 * 1000);
}

module.exports = {
    startScheduler,
    getMoscowDateTimeString,
    calculateNextScheduledTime
};
