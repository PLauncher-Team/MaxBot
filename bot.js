const path = require('path');
const fs = require('fs');
const db = require('./db');
const { BOT_TOKEN } = require('./auth');

let botInstance = null;
const sentMessageMids = {};
const MAX_BOT_OWNER_ID = String(process.env.MAX_BOT_OWNER_ID || '').trim();
const pendingDatabaseClear = new Map();

function getCommandUserId(ctx) {
    const update = ctx.update || {};
    const sender = update.message?.sender || {};
    const user = update.user || update.message?.user || update.callback?.user || ctx.user || {};
    const userId = sender.user_id || sender.id || user.user_id || user.id;
    return userId ? String(userId) : null;
}

function clearDatabase() {
    const clear = db.transaction(() => {
        db.exec(`
            DELETE FROM recipient_download_tickets;
            DELETE FROM feedback_files;
            DELETE FROM feedback_views;
            DELETE FROM recipient_question_views;
            DELETE FROM recipient_questions;
            DELETE FROM feedback_submissions;
            DELETE FROM responses;
            DELETE FROM participant_groups;
            DELETE FROM participants;
            DELETE FROM groups;
            DELETE FROM reminders;
            DELETE FROM templates;
            DELETE FROM template_seed_state;
            DELETE FROM uploaded_media;
            DELETE FROM sqlite_sequence;
        `);
    });
    clear();

    const uploadsDir = path.join(__dirname, 'data', 'uploads');
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    fs.mkdirSync(uploadsDir, { recursive: true });
}

function getStoredReplyMessages(reminderId) {
    const row = db.prepare('SELECT reply_message_ids FROM reminders WHERE id = ?').get(reminderId);
    const parsed = safeJsonParse(row?.reply_message_ids, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function safeJsonParse(value, fallback) {
    if (!value || typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value);
    } catch (e) {
        return fallback;
    }
}

function normalizeReplyRecords(value) {
    if (Array.isArray(value)) return value.filter(record => record && record.mid);
    if (value && typeof value === 'object' && value.mid) return [value];
    return [];
}

function resolveChatIdForMessage(reminderId, originalMid, update, ctxUser) {
    if (originalMid) {
        const row = db.prepare('SELECT message_ids FROM reminders WHERE id = ?').get(reminderId);
        const messageIds = safeJsonParse(row?.message_ids, {});
        const match = Object.entries(messageIds).find(([, mid]) => String(mid) === String(originalMid));
        if (match) return String(match[0]);

        const suffix = '_' + reminderId;
        for (const [key, mid] of Object.entries(sentMessageMids)) {
            if (key.endsWith(suffix) && String(mid) === String(originalMid)) {
                return key.slice(0, -suffix.length);
            }
        }
    }

    const recipient = update.message?.recipient || {};
    const callbackUser = update.callback?.user || update.user || ctxUser || {};
    const candidate = update.chat_id || recipient.chat_id || recipient.user_id || callbackUser.user_id;
    return candidate ? String(candidate) : null;
}

function storeReplyMessage(reminderId, chatId, replyMid, parentMid) {
    const replyMessages = getStoredReplyMessages(reminderId);
    const records = normalizeReplyRecords(replyMessages[String(chatId)]);
    records.push({
        mid: String(replyMid),
        parent_mid: parentMid ? String(parentMid) : null
    });
    replyMessages[String(chatId)] = records;
    db.prepare('UPDATE reminders SET reply_message_ids = ? WHERE id = ?')
        .run(JSON.stringify(replyMessages), reminderId);
}

async function deleteLinkedReplyMessages(reminderId, chatId, parentMid) {
    const replyMessages = getStoredReplyMessages(reminderId);
    const chatKey = String(chatId);
    const records = normalizeReplyRecords(replyMessages[chatKey]);
    if (records.length === 0) return true;

    const remaining = [];
    let failed = false;
    let deletedAny = false;

    for (const record of records) {
        const isLinked = !parentMid || String(record.parent_mid) === String(parentMid);
        if (!isLinked) {
            remaining.push(record);
            continue;
        }

        if (deletedAny) await new Promise(resolve => setTimeout(resolve, 550));
        const deleted = await deleteMaxMessage(BOT_TOKEN, record.mid);
        deletedAny = true;

        if (!deleted) {
            remaining.push(record);
            failed = true;
        }
    }

    if (remaining.length > 0) {
        replyMessages[chatKey] = remaining;
    } else {
        delete replyMessages[chatKey];
    }

    db.prepare('UPDATE reminders SET reply_message_ids = ? WHERE id = ?')
        .run(JSON.stringify(replyMessages), reminderId);

    if (deletedAny) await new Promise(resolve => setTimeout(resolve, 550));
    return !failed;
}

async function deleteMaxMessage(botToken, mid) {
    if (!botToken || !mid) return false;
    try {
        const response = await fetch(`https://platform-api2.max.ru/messages?message_id=${encodeURIComponent(mid)}`, {
            method: 'DELETE',
            headers: { Authorization: botToken }
        });
        if (response.status === 404) return true;
        if (!response.ok) return false;
        const result = await response.json().catch(() => null);
        return !result || result.success !== false;
    } catch (e) {
        return false;
    }
}

async function editMaxMessage(botToken, mid, text, sender = null) {
    if (!botToken || !mid) return false;
    try {
        const senderId = String(sender?.id || '').replace(/[^0-9]/g, '');
        const senderName = String(sender?.name || '').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const senderMarkup = senderId
            ? '<blockquote>От кого: <a href="max://user/' + senderId + '">' + (senderName || 'Учитель') + '</a></blockquote>'
            : '';
        const safeText = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        const response = await fetch(`https://platform-api2.max.ru/messages?message_id=${encodeURIComponent(mid)}`, {
            method: 'PUT',
            headers: {
                Authorization: botToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: senderMarkup + safeText, format: 'html' })
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

async function handleBotStart(ctx) {
    try {
        let text = '';
        const update = ctx.update || {};
        if (typeof update.payload === 'string') {
            text = update.payload;
        } else if (typeof ctx.start_param === 'string') {
            text = ctx.start_param;
        } else if (update.message && update.message.body && typeof update.message.body.text === 'string') {
            text = update.message.body.text;
        } else if (typeof ctx.text === 'string') {
            text = ctx.text;
        }

        let senderId = null;
        let senderUserId = null;
        let senderName = 'Участник';

        if (update.chat_id) {
            senderId = String(update.chat_id);
        }
        if (update.user) {
            if (update.user.user_id) {
                senderUserId = String(update.user.user_id);
            }
            if (!senderId && update.user.user_id) {
                senderId = String(update.user.user_id);
            }
            senderName = update.user.name || [update.user.first_name, update.user.last_name].filter(Boolean).join(' ') || ('Участник ' + senderId);
        }

        if (!senderId && ctx.user) {
            senderId = String(ctx.user.user_id || ctx.user.id || '');
            senderUserId = String(ctx.user.user_id || ctx.user.id || '');
            senderName = ctx.user.name || [ctx.user.first_name, ctx.user.last_name].filter(Boolean).join(' ') || ('Участник ' + senderId);
        } else if (!senderUserId && ctx.user) {
            senderUserId = String(ctx.user.user_id || ctx.user.id || '');
        }

        if (!senderId) return;

        let uniqueId = null;
        const match = text.match(/(?:group_|g_)([a-zA-Z0-9_]+)/);
        if (match) {
            uniqueId = 'g_' + match[1].replace(/^g_/, '');
        }

        if (uniqueId) {
            const group = db.prepare('SELECT * FROM groups WHERE unique_id = ?').get(uniqueId);
            if (group) {
                const joinGroup = db.transaction(() => {
                    const existing = db.prepare('SELECT id FROM participants WHERE teacher_id = ? AND (chat_id = ? OR user_id = ?)').get(group.user_id, senderId, senderUserId || senderId);
                    let participantId;
                    if (existing) {
                        participantId = existing.id;
                        db.prepare('UPDATE participants SET chat_id = ?, user_id = COALESCE(user_id, ?), name = ?, group_id = COALESCE(group_id, ?) WHERE id = ?')
                            .run(senderId, senderUserId || senderId, senderName, group.id, participantId);
                    } else {
                        const created = db.prepare('INSERT INTO participants (teacher_id, group_id, chat_id, user_id, name) VALUES (?, ?, ?, ?, ?)')
                            .run(group.user_id, group.id, senderId, senderUserId || senderId, senderName);
                        participantId = created.lastInsertRowid;
                    }
                    db.prepare('INSERT OR IGNORE INTO participant_groups (participant_id, group_id) VALUES (?, ?)')
                        .run(participantId, group.id);
                });
                joinGroup();

                const replyMsg = `Вы успешно присоединились к группе "${group.name}"! Теперь вы будете получать важные напоминания.`;
                if (typeof ctx.reply === 'function') {
                    await ctx.reply(replyMsg);
                } else if (botInstance) {
                    await botInstance.api.sendMessageToUser(senderId, replyMsg);
                }
                return;
            }
        }

        const welcomeMsg = 'Добро пожаловать в Бота-напоминателя! Подключайтесь к группам по ссылкам от ваших преподавателей.';
        if (typeof ctx.reply === 'function') {
            await ctx.reply(welcomeMsg);
        } else if (botInstance && senderId) {
            await botInstance.api.sendMessageToUser(senderId, welcomeMsg);
        }
    } catch (e) {
        console.error('Bot start handler error:', e);
    }
}

try {
    const { Bot } = require('@maxhub/max-bot-api');
    if (BOT_TOKEN) {
        botInstance = new Bot(BOT_TOKEN);
        if (typeof botInstance.command === 'function') {
            botInstance.command('start', handleBotStart);
            botInstance.command('clear_db', async (ctx) => {
                const userId = getCommandUserId(ctx);
                if (!MAX_BOT_OWNER_ID || userId !== MAX_BOT_OWNER_ID) {
                    if (typeof ctx.reply === 'function') await ctx.reply('Команда недоступна.');
                    return;
                }

                pendingDatabaseClear.set(userId, Date.now() + 60 * 1000);
                if (typeof ctx.reply === 'function') {
                    await ctx.reply('ВНИМАНИЕ: будут удалены все группы, участники, напоминания, шаблоны, ответы и загруженные файлы. Для подтверждения в течение 60 секунд отправьте /confirm_clear_db. Для отмены — /cancel_clear_db.');
                }
            });
            botInstance.command('confirm_clear_db', async (ctx) => {
                const userId = getCommandUserId(ctx);
                if (!MAX_BOT_OWNER_ID || userId !== MAX_BOT_OWNER_ID) {
                    if (typeof ctx.reply === 'function') await ctx.reply('Команда недоступна.');
                    return;
                }

                const expiresAt = pendingDatabaseClear.get(userId);
                pendingDatabaseClear.delete(userId);
                if (!expiresAt || expiresAt < Date.now()) {
                    if (typeof ctx.reply === 'function') await ctx.reply('Подтверждение не найдено или истекло. Сначала отправьте /clear_db.');
                    return;
                }

                try {
                    clearDatabase();
                    if (typeof ctx.reply === 'function') await ctx.reply('База данных очищена. Все данные удалены.');
                } catch (error) {
                    console.error('Database clear failed:', error);
                    if (typeof ctx.reply === 'function') await ctx.reply('Не удалось очистить базу данных. Проверьте журнал сервера.');
                }
            });
            botInstance.command('cancel_clear_db', async (ctx) => {
                const userId = getCommandUserId(ctx);
                if (userId) pendingDatabaseClear.delete(userId);
                if (typeof ctx.reply === 'function') await ctx.reply('Очистка базы данных отменена.');
            });
        }
        if (typeof botInstance.on === 'function') {
            botInstance.on('bot_started', handleBotStart);
            botInstance.on('message_created', handleBotStart);
        }
        if (typeof botInstance.action === 'function') {
            botInstance.action(/ans:([0-9]+):(.+)/, async (ctx) => {
                try {
                    const reminderId = ctx.match[1];
                    const answerText = ctx.match[2];
                    const update = ctx.update || {};
                    const recipient = update.message?.recipient || {};
                    const tentativeKey = update.chat_id || recipient.chat_id || recipient.user_id || update.callback?.user?.user_id || ctx.user?.user_id;
                    const tentativeSenderId = tentativeKey ? String(tentativeKey) : null;
                    const tentativeMid = update.message?.body?.mid || update.message?.mid || update.mid || null;
                    const originalMid = tentativeMid || (tentativeSenderId ? sentMessageMids[tentativeSenderId + '_' + reminderId] : null);
                    const senderId = resolveChatIdForMessage(reminderId, originalMid, update, ctx.user);

                    if (!senderId) return;

                    const key = senderId + '_' + reminderId;

                    await deleteLinkedReplyMessages(reminderId, senderId);

                    const options = originalMid ? { link: { type: 'reply', mid: originalMid } } : {};
                    const sentReply = await ctx.reply(`${answerText}`, options);
                    const replyMid = sentReply?.message?.body?.mid
                        || sentReply?.body?.mid
                        || sentReply?.mid
                        || sentReply?.body?.message_id;

                    if (replyMid) {
                        storeReplyMessage(reminderId, senderId, replyMid, originalMid);
                    }
                } catch (err) {
                    console.error('Action handler error:', err);
                }
            });
        }
        botInstance.start().catch((err) => {
            console.error('MAX Bot API start error:', err);
        });
    }
} catch (e) {
    console.error('MAX Bot API require error:', e);
}

let cachedBotUsername = null;
let botUsernamePromise = null;

async function getMiniAppBotUsername() {
    if (cachedBotUsername) return cachedBotUsername;
    if (botUsernamePromise) return botUsernamePromise;

    botUsernamePromise = (async () => {
        if (!botInstance?.api || typeof botInstance.api.getMyInfo !== 'function') {
            throw new Error('MAX Bot API is not initialized');
        }

        const botInfo = await botInstance.api.getMyInfo();
        const username = String(botInfo?.username || '').replace(/^@/, '').trim();
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(username)) {
            throw new Error('MAX bot username is not available');
        }

        cachedBotUsername = username;
        return username;
    })();

    try {
        return await botUsernamePromise;
    } finally {
        botUsernamePromise = null;
    }
}

async function sendQuickReplyMessage(reminderId, chatId, userId, answerText) {
    if (!botInstance || typeof answerText !== 'string' || !answerText.trim()) return false;

    const reminder = db.prepare('SELECT message_ids FROM reminders WHERE id = ?').get(reminderId);
    const messageIds = safeJsonParse(reminder?.message_ids, {});
    const parentMid = messageIds[String(chatId)];
    if (!parentMid) return false;

    if (!await deleteLinkedReplyMessages(reminderId, chatId, parentMid)) return false;

    const replyText = answerText.trim().slice(0, 500);
    const replyOptions = { link: { type: 'reply', mid: String(parentMid) } };
    let sentReply;
    try {
        sentReply = await botInstance.api.sendMessageToUser(userId, replyText, replyOptions);
    } catch (error) {
        sentReply = await botInstance.api.sendMessageToChat(chatId, replyText, replyOptions);
    }
    const replyMid = sentReply?.message?.body?.mid
        || sentReply?.body?.mid
        || sentReply?.mid
        || sentReply?.body?.message_id;

    if (!replyMid) return false;
    storeReplyMessage(reminderId, chatId, replyMid, parentMid);
    return true;
}

async function sendBroadcastMessage(reminderId, chatIds, text, quickReplies, images, sender = null) {
    const result = {
        sentChatIds: [],
        failedChatIds: [],
        messageIds: {}
    };
    const uniqueChatIds = [...new Set((Array.isArray(chatIds) ? chatIds : []).filter(Boolean).map(String))];

    if (!botInstance) {
        result.failedChatIds = uniqueChatIds;
        console.error('sendBroadcastMessage failed: botInstance is null');
        return result;
    }

    try {
        const { Keyboard } = require('@maxhub/max-bot-api');
        const botUsername = await getMiniAppBotUsername();
        let attachments = [];
        const chatImages = Array.isArray(images)
            ? images.filter(item => item && item.type === 'image').slice(0, 3)
            : [];

        for (const img of chatImages) {
            if (typeof img === 'object' && typeof img.toJson === 'function') {
                attachments.push(img.toJson());
                continue;
            }

            if (typeof img === 'object' && img.payload && img.type === 'image') {
                attachments.push(img);
                continue;
            }

            const urlStr = typeof img === 'string' ? img : (img.url || '');
            if (!urlStr) continue;

            const match = urlStr.match(/\/api\/uploads\/([^/?#]+)(?:[?#]|$)/);
            if (match && match[1]) {
                const filename = match[1];
                const filePath = path.join(__dirname, 'data', 'uploads', filename);
                if (fs.existsSync(filePath) && typeof botInstance.api?.uploadImage === 'function') {
                    try {
                        const uploadedImage = await botInstance.api.uploadImage({ source: filePath });
                        if (uploadedImage && typeof uploadedImage.toJson === 'function') {
                            attachments.push(uploadedImage.toJson());
                        } else if (uploadedImage && uploadedImage.payload) {
                            attachments.push({ type: 'image', payload: uploadedImage.payload });
                        } else {
                            throw new Error('MAX did not return an image attachment');
                        }
                        continue;
                    } catch (uploadError) {
                        console.error('Image upload to MAX failed for', filename, ':', uploadError.message || uploadError);
                        throw uploadError;
                    }
                }
            }

            attachments.push({ type: 'image', payload: { url: urlStr } });
        }

        attachments.push(Keyboard.inlineKeyboard([
            [Keyboard.button.openApp('Подробнее', botUsername, undefined, `r_${reminderId}`)]
        ]));

        const senderId = String(sender?.id || '').trim();
        const senderName = String(sender?.name || '').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const senderMarkup = senderId
            ? '<blockquote>От кого: <a href="max://user/' + senderId.replace(/[^0-9]/g, '') + '">' + (senderName || 'Учитель') + '</a></blockquote>'
            : '';
        const safeMessageText = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const messageText = senderMarkup + safeMessageText;
        const messageOptions = { attachments, format: 'html' };

        for (const chatId of uniqueChatIds) {
            let sentSuccess = false;
            let lastError = null;

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const resMsg = await botInstance.api.sendMessageToUser(chatId, messageText, messageOptions);
                    const mid = resMsg && (resMsg.body?.mid || resMsg.mid || resMsg.body?.message_id);
                    if (mid) {
                        sentMessageMids[chatId + '_' + reminderId] = mid;
                        result.messageIds[chatId] = mid;
                    }
                    sentSuccess = true;
                    break;
                } catch (e) {
                    lastError = e;
                    if (attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
                    }
                }
            }

            if (!sentSuccess) {
                try {
                    const resMsg = await botInstance.api.sendMessageToChat(chatId, messageText, messageOptions);
                    const mid = resMsg && (resMsg.body?.mid || resMsg.mid || resMsg.body?.message_id);
                    if (mid) {
                        sentMessageMids[chatId + '_' + reminderId] = mid;
                        result.messageIds[chatId] = mid;
                    }
                    sentSuccess = true;
                } catch (e) {
                    lastError = e;
                }
            }

            if (sentSuccess) {
                result.sentChatIds.push(chatId);
            } else {
                result.failedChatIds.push(chatId);
                console.error('Message delivery failed for chat', chatId, lastError);
            }
        }
    } catch (err) {
        console.error('BROADCAST FATAL ERROR:', err);
        result.failedChatIds = uniqueChatIds.filter(chatId => !result.sentChatIds.includes(chatId));
    }

    return result;
}
module.exports = {
    botInstance,
    getMiniAppBotUsername,
    sendBroadcastMessage,
    sendQuickReplyMessage,
    deleteMaxMessage,
    deleteLinkedReplyMessages,
    editMaxMessage
};
