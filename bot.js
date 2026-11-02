const path = require('path');
const fs = require('fs');
const db = require('./db');
const { BOT_TOKEN } = require('./auth');

let botInstance = null;
const lastReplyMid = {};
const sentMessageMids = {};

async function deleteMaxMessage(botToken, mid) {
    if (!botToken || !mid) return false;
    try {
        const response = await fetch(`https://platform-api2.max.ru/messages?message_id=${encodeURIComponent(mid)}`, {
            method: 'DELETE',
            headers: { Authorization: botToken }
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

async function editMaxMessage(botToken, mid, text) {
    if (!botToken || !mid) return false;
    try {
        const response = await fetch(`https://platform-api2.max.ru/messages?message_id=${encodeURIComponent(mid)}`, {
            method: 'PUT',
            headers: {
                Authorization: botToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
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
        let senderName = 'Участник';

        if (update.chat_id) {
            senderId = String(update.chat_id);
        }
        if (update.user) {
            if (!senderId && update.user.user_id) {
                senderId = String(update.user.user_id);
            }
            senderName = update.user.name || [update.user.first_name, update.user.last_name].filter(Boolean).join(' ') || ('Участник ' + senderId);
        }

        if (!senderId && ctx.user) {
            senderId = String(ctx.user.user_id || ctx.user.id || '');
            senderName = ctx.user.name || [ctx.user.first_name, ctx.user.last_name].filter(Boolean).join(' ') || ('Участник ' + senderId);
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
                const existing = db.prepare('SELECT id FROM participants WHERE teacher_id = ? AND chat_id = ?').get(group.user_id, senderId);
                if (existing) {
                    db.prepare('UPDATE participants SET group_id = ?, name = ? WHERE id = ?').run(group.id, senderName, existing.id);
                } else {
                    db.prepare('INSERT INTO participants (teacher_id, group_id, chat_id, name) VALUES (?, ?, ?, ?)').run(group.user_id, group.id, senderId, senderName);
                }

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
                    let senderId = null;
                    const update = ctx.update || {};
                    if (update.chat_id) {
                        senderId = String(update.chat_id);
                    } else if (update.user && update.user.user_id) {
                        senderId = String(update.user.user_id);
                    } else if (ctx.user && ctx.user.user_id) {
                        senderId = String(ctx.user.user_id);
                    }

                    if (!senderId) return;

                    const key = senderId + '_' + reminderId;
                    const messageId = lastReplyMid[key];

                    if (messageId) {
                        try {
                            if (typeof ctx.api?.deleteMessage === 'function') {
                                await ctx.api.deleteMessage(messageId);
                            } else if (botInstance && typeof botInstance.api?.deleteMessage === 'function') {
                                await botInstance.api.deleteMessage(messageId);
                            } else {
                                await deleteMaxMessage(BOT_TOKEN, messageId);
                            }
                            delete lastReplyMid[key];
                        } catch (err) {
                            console.error('Delete error:', err);
                        }
                    }

                    const originalMid = update.message?.body?.mid || update.message?.mid || update.mid || sentMessageMids[key];
                    const options = originalMid ? { link: { type: 'reply', mid: originalMid } } : {};

                    const sentReply = await ctx.reply(`${answerText}`, options);
                    let replyMid = null;
                    if (sentReply) {
                        if (sentReply.body && sentReply.body.mid) {
                            replyMid = sentReply.body.mid;
                        } else if (sentReply.mid) {
                            replyMid = sentReply.mid;
                        } else if (sentReply.body && sentReply.body.message_id) {
                            replyMid = sentReply.body.message_id;
                        }
                    }
                    if (replyMid) {
                        lastReplyMid[key] = replyMid;
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

async function sendBroadcastMessage(reminderId, chatIds, text, quickReplies, images) {
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
        let attachments = [];

        if (Array.isArray(images) && images.length > 0) {
            for (const img of images.slice(0, 11)) {
                if (!img) continue;

                if (typeof img === 'object' && typeof img.toJson === 'function') {
                    attachments.push(img.toJson());
                    continue;
                }

                if (typeof img === 'object' && img.payload && (img.type === 'image' || img.type === 'video')) {
                    attachments.push(img);
                    continue;
                }

                const urlStr = typeof img === 'string' ? img : (img.url || '');
                if (urlStr) {
                    const match = urlStr.match(/\/api\/uploads\/([^/?#]+)$/);
                    if (match && match[1]) {
                        const filename = match[1];
                        const filePath = path.join(__dirname, 'data', 'uploads', filename);
                        if (fs.existsSync(filePath)) {
                            const isVid = filename.startsWith('vid_') || /\.(mp4|mov|webm|avi|mkv)$/i.test(filename);
                            try {
                                if (isVid && typeof botInstance.api?.uploadVideo === 'function') {
                                    const uploadedVid = await botInstance.api.uploadVideo({ source: filePath });
                                    if (uploadedVid && typeof uploadedVid.toJson === 'function') {
                                        attachments.push(uploadedVid.toJson());
                                    } else if (uploadedVid && uploadedVid.payload) {
                                        attachments.push({ type: 'video', payload: uploadedVid.payload });
                                    }
                                    continue;
                                } else if (!isVid && typeof botInstance.api?.uploadImage === 'function') {
                                    const uploadedImg = await botInstance.api.uploadImage({ source: filePath });
                                    if (uploadedImg && typeof uploadedImg.toJson === 'function') {
                                        attachments.push(uploadedImg.toJson());
                                    } else if (uploadedImg && uploadedImg.payload) {
                                        attachments.push({ type: 'image', payload: uploadedImg.payload });
                                    }
                                    continue;
                                }
                            } catch (uploadErr) {
                                console.error('Upload to MAX failed for', filename, ':', uploadErr.message || uploadErr);
                            }
                        }
                    }
                }

                if (typeof img === 'string') {
                    if (/^https?:\/\//i.test(img)) {
                        const isVid = /\.(mp4|mov|webm|avi|mkv)$/i.test(img);
                        attachments.push({
                            type: isVid ? 'video' : 'image',
                            payload: { url: img }
                        });
                    }
                } else if (typeof img === 'object') {
                    const isVid = img.type === 'video' || (img.url && /\.(mp4|mov|webm|avi|mkv)$/i.test(img.url));
                    const attType = isVid ? 'video' : 'image';

                    if (img.photos) {
                        attachments.push({
                            type: 'image',
                            payload: { photos: img.photos }
                        });
                    } else if (img.token) {
                        attachments.push({
                            type: attType,
                            payload: { token: img.token }
                        });
                    } else if (img.url) {
                        attachments.push({
                            type: attType,
                            payload: { url: img.url }
                        });
                    }
                }
            }
        }

        if (Array.isArray(quickReplies) && quickReplies.length > 0) {
            const buttons = quickReplies.map(qr => [
                Keyboard.button.callback(qr.question, `ans:${reminderId}:${qr.answer}`)
            ]);
            attachments.push(Keyboard.inlineKeyboard(buttons));
        }

        for (const chatId of uniqueChatIds) {
            let sentSuccess = false;
            let lastError = null;

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const resMsg = await botInstance.api.sendMessageToUser(chatId, text, { attachments });
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
                    const resMsg = await botInstance.api.sendMessageToChat(chatId, text, { attachments });
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
    sendBroadcastMessage,
    deleteMaxMessage,
    editMaxMessage
};
