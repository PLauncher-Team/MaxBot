const CreateScreen = {
    currentQuickReplies: [],
    selectedGroups: [],
    currentImages: [],

    repeatOptions: ['Никогда', 'Каждую минуту', 'Каждый день', 'Каждую неделю', 'Каждый месяц'],
    repeatIndex: 0,

    getMinDateTimeString: function() {
        const d = new Date();
        d.setMinutes(d.getMinutes() + 1);
        const pad = (n) => String(n).padStart(2, '0');
        const year = d.getFullYear();
        const month = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const hours = pad(d.getHours());
        const mins = pad(d.getMinutes());
        return `${year}-${month}-${day}T${hours}:${mins}`;
    },

    renderImagesPreview: function() {
        const grid = document.getElementById('media-preview-grid') || document.getElementById('images-preview-grid');
        if (!grid) return;
        grid.innerHTML = '';

        this.currentImages.forEach((imgObj, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'image-preview-thumb';
            const imgUrl = typeof imgObj === 'string' ? imgObj : (imgObj.url || '');
            const isVideo = (typeof imgObj === 'object' && imgObj.type === 'video') || /\.(mp4|mov|webm|avi|mkv)$/i.test(imgUrl);

            if (isVideo) {
                thumb.innerHTML = `
                    <video src="${App.escapeHtml(imgUrl)}" style="width: 100%; height: 100%; object-fit: cover;"></video>
                    <button type="button" class="image-preview-del" data-index="${index}">✕</button>
                `;
            } else {
                thumb.innerHTML = `
                    <img src="${App.escapeHtml(imgUrl)}" alt="preview">
                    <button type="button" class="image-preview-del" data-index="${index}">✕</button>
                `;
            }

            thumb.querySelector('.image-preview-del').addEventListener('click', (e) => {
                e.stopPropagation();
                this.currentImages.splice(index, 1);
                this.renderImagesPreview();
            });
            grid.appendChild(thumb);
        });
    },

    populateForEdit: function(reminder) {
        App.editingReminderId = reminder.id;
        const titleInput = document.getElementById('create-title-input');
        const descInput = document.getElementById('create-desc-input');
        const sendNowToggle = document.getElementById('send-now-toggle');
        const sendTimeRow = document.getElementById('send-time-picker-row');
        const sendDateTime = document.getElementById('send-datetime-input');
        const repeatTimeRow = document.getElementById('repeat-time-picker-row');
        const repeatTypeText = document.getElementById('repeat-type-text');
        const repeatTimeInput = document.getElementById('repeat-time-input');
        const sendToSelfToggle = document.getElementById('send-to-self-toggle');
        const headerTitle = document.querySelector('#create-screen .create-title');
        const saveBtn = document.getElementById('save-reminder-btn');

        if (headerTitle) headerTitle.textContent = 'Редактирование напоминания';
        if (saveBtn) {
            saveBtn.childNodes[0].nodeValue = 'Сохранить изменения ';
        }

        if (titleInput) titleInput.value = reminder.title || '';
        if (descInput) descInput.value = reminder.description || '';
        this.currentQuickReplies = Array.isArray(reminder.quick_replies) ? [...reminder.quick_replies] : [];
        this.currentImages = Array.isArray(reminder.images) ? [...reminder.images] : [];

        if (sendNowToggle) {
            sendNowToggle.classList.remove('active');
        }
        if (sendTimeRow) {
            sendTimeRow.style.display = 'flex';
        }
        if (sendDateTime && reminder.scheduled_time) {
            sendDateTime.value = reminder.scheduled_time;
        }

        const repType = reminder.repeat_type || 'Никогда';
        const repIdx = this.repeatOptions.indexOf(repType);
        this.repeatIndex = repIdx !== -1 ? repIdx : 0;
        if (repeatTypeText) repeatTypeText.textContent = this.repeatOptions[this.repeatIndex];
        if (repeatTimeRow) {
            repeatTimeRow.style.display = ['Никогда', 'Каждую минуту'].includes(this.repeatOptions[this.repeatIndex]) ? 'none' : 'flex';
        }
        if (repeatTimeInput && reminder.repeat_time) {
            repeatTimeInput.value = reminder.repeat_time;
        }

        const recipients = Array.isArray(reminder.recipients) ? reminder.recipients : [];
        const hasSelf = recipients.includes('Себе');
        if (sendToSelfToggle) {
            if (hasSelf) sendToSelfToggle.classList.add('active');
            else sendToSelfToggle.classList.remove('active');
        }

        this.selectedGroups = recipients.filter(r => r !== 'Себе');
        this.renderQuickReplies();
        this.renderSelectedRecipients();
        this.renderImagesPreview();
    },

    populateForm: function(template) {
        App.editingReminderId = null;
        const titleInput = document.getElementById('create-title-input');
        const descInput = document.getElementById('create-desc-input');
        const sendNowToggle = document.getElementById('send-now-toggle');
        const sendTimeRow = document.getElementById('send-time-picker-row');
        const sendDateTime = document.getElementById('send-datetime-input');
        const repeatTimeRow = document.getElementById('repeat-time-picker-row');
        const repeatTypeText = document.getElementById('repeat-type-text');
        const sendToSelfToggle = document.getElementById('send-to-self-toggle');
        const headerTitle = document.querySelector('#create-screen .create-title');
        const saveBtn = document.getElementById('save-reminder-btn');

        if (headerTitle) headerTitle.textContent = 'Новое напоминание';
        if (saveBtn) {
            saveBtn.childNodes[0].nodeValue = 'Запланировать отправку ';
        }

        if (template) {
            if (titleInput) titleInput.value = template.title || '';
            if (descInput) descInput.value = template.description || '';
            this.currentQuickReplies = Array.isArray(template.quick_replies) ? [...template.quick_replies] : [];
        } else {
            if (titleInput) titleInput.value = '';
            if (descInput) descInput.value = '';
            this.currentQuickReplies = [];
        }

        this.currentImages = [];

        if (sendNowToggle) {
            sendNowToggle.classList.add('active');
        }
        if (sendToSelfToggle) {
            sendToSelfToggle.classList.add('active');
        }
        if (sendTimeRow) {
            sendTimeRow.style.display = 'none';
        }
        if (sendDateTime) {
            const minStr = this.getMinDateTimeString();
            sendDateTime.min = minStr;
            const defDate = new Date();
            defDate.setMinutes(defDate.getMinutes() + 30);
            const pad = (n) => String(n).padStart(2, '0');
            sendDateTime.value = `${defDate.getFullYear()}-${pad(defDate.getMonth() + 1)}-${pad(defDate.getDate())}T${pad(defDate.getHours())}:${pad(defDate.getMinutes())}`;
        }

        this.repeatIndex = 0;
        if (repeatTypeText) {
            repeatTypeText.textContent = this.repeatOptions[0];
        }
        if (repeatTimeRow) {
            repeatTimeRow.style.display = 'none';
        }

        this.selectedGroups = [];
        this.renderQuickReplies();
        this.renderSelectedRecipients();
        this.renderImagesPreview();
    },

    renderQuickReplies: function() {
        const list = document.getElementById('quick-replies-list');
        if (!list) return;
        list.innerHTML = '';

        this.currentQuickReplies.forEach((qr, index) => {
            const card = document.createElement('div');
            card.className = 'quick-reply-card';
            card.innerHTML = `
                <div class="quick-reply-card-header">
                    <span class="quick-reply-question">${App.escapeHtml(qr.question)}</span>
                    <button class="quick-reply-delete" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="quick-reply-answer">${App.escapeHtml(qr.answer)}</div>
            `;
            list.appendChild(card);
        });

        list.querySelectorAll('.quick-reply-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                this.currentQuickReplies.splice(idx, 1);
                this.renderQuickReplies();
            });
        });
    },

    renderSelectedRecipients: function() {
        const recipientList = document.getElementById('recipient-list');
        if (!recipientList) return;
        recipientList.innerHTML = '';

        const sendToSelfActive = document.getElementById('send-to-self-toggle')?.classList.contains('active');
        let totalCount = this.selectedGroups.length;

        if (sendToSelfActive) {
            const selfItem = document.createElement('div');
            selfItem.className = 'recipient-item';
            selfItem.innerHTML = `
                <div class="recipient-check">
                    <svg width="12" height="12" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <div class="recipient-avatar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#007aff"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                </div>
                <div class="recipient-info">
                    <div class="recipient-name">Себе</div>
                    <div class="recipient-status">Личное сообщение</div>
                </div>
            `;
            recipientList.appendChild(selfItem);
            totalCount++;
        }

        this.selectedGroups.forEach(gName => {
            const item = document.createElement('div');
            item.className = 'recipient-item';
            item.innerHTML = `
                <div class="recipient-check">
                    <svg width="12" height="12" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <div class="recipient-avatar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#007aff"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                </div>
                <div class="recipient-info">
                    <div class="recipient-name">${App.escapeHtml(gName)}</div>
                    <div class="recipient-status">Группа</div>
                </div>
            `;
            recipientList.appendChild(item);
        });

        this.updateRecipientsBadge(totalCount);
    },

    updateRecipientsBadge: function(count) {
        const badge = document.getElementById('recipients-badge');
        if (badge) {
            badge.textContent = count !== undefined ? count : 1;
        }
    },

    openRecipientModal: async function() {
        const modal = document.getElementById('recipient-modal');
        const listContainer = document.getElementById('groups-modal-list');
        const countSpan = document.getElementById('recipient-modal-count');

        if (!modal || !listContainer) return;

        const groups = await App.getGroups();
        let selectedMap = {};
        this.selectedGroups.forEach(gName => { selectedMap[gName] = true; });

        const renderModalGroups = () => {
            listContainer.innerHTML = '';

            groups.forEach(g => {
                const isChecked = Boolean(selectedMap[g.name]);

                const card = document.createElement('div');
                card.className = 'contact-modal-item';
                card.innerHTML = `
                    <div class="recipient-check ${isChecked ? '' : 'unchecked'}">
                        <svg width="12" height="12" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <div class="contact-modal-info">
                        <div class="contact-modal-name">${App.escapeHtml(g.name)}</div>
                        <div class="contact-modal-status">${g.participant_count || 0} участников</div>
                    </div>
                `;

                card.addEventListener('click', () => {
                    const check = card.querySelector('.recipient-check');
                    if (selectedMap[g.name]) {
                        delete selectedMap[g.name];
                        check.classList.add('unchecked');
                    } else {
                        selectedMap[g.name] = true;
                        check.classList.remove('unchecked');
                    }
                    if (countSpan) countSpan.textContent = Object.keys(selectedMap).length;
                });

                listContainer.appendChild(card);
            });

            if (countSpan) countSpan.textContent = Object.keys(selectedMap).length;
        };

        renderModalGroups();

        modal.style.display = 'flex';

        const confirmBtn = document.getElementById('recipient-modal-confirm');
        if (confirmBtn) {
            confirmBtn.onclick = () => {
                this.selectedGroups = Object.keys(selectedMap);
                this.renderSelectedRecipients();
                modal.style.display = 'none';
            };
        }

        const cancelBtn = document.getElementById('recipient-modal-cancel');
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                modal.style.display = 'none';
            };
        }
    },

    init: function() {
        const sendNowToggle = document.getElementById('send-now-toggle');
        const sendToSelfToggle = document.getElementById('send-to-self-toggle');
        const sendTimeRow = document.getElementById('send-time-picker-row');
        const sendDateTimeInput = document.getElementById('send-datetime-input');
        const repeatTypeBtn = document.getElementById('repeat-type-btn');
        const repeatTypeText = document.getElementById('repeat-type-text');
        const repeatTimeRow = document.getElementById('repeat-time-picker-row');
        const qInput = document.getElementById('quick-reply-q-input');
        const aInput = document.getElementById('quick-reply-a-input');
        const addReplyBtn = document.getElementById('quick-reply-add-btn');
        const recipientAddRow = document.getElementById('recipient-add-row');
        const saveReminderBtn = document.getElementById('save-reminder-btn');
        const addMediaBtn = document.getElementById('add-media-btn') || document.getElementById('add-image-btn');
        const createMediaInput = document.getElementById('create-media-input') || document.getElementById('create-image-input');

        if (sendNowToggle) {
            sendNowToggle.addEventListener('click', () => {
                const isActive = sendNowToggle.classList.toggle('active');
                if (sendTimeRow) {
                    sendTimeRow.style.display = isActive ? 'none' : 'flex';
                }
                if (!isActive && sendDateTimeInput) {
                    sendDateTimeInput.min = this.getMinDateTimeString();
                }
            });
        }

        if (sendToSelfToggle) {
            sendToSelfToggle.addEventListener('click', () => {
                sendToSelfToggle.classList.toggle('active');
                this.renderSelectedRecipients();
            });
        }

        if (sendDateTimeInput) {
            sendDateTimeInput.addEventListener('change', () => {
                const minStr = this.getMinDateTimeString();
                if (sendDateTimeInput.value < minStr) {
                    sendDateTimeInput.value = minStr;
                    App.showToast('Время не может быть меньше текущего');
                }
            });
        }

        if (repeatTypeBtn && repeatTypeText) {
            repeatTypeBtn.addEventListener('click', () => {
                this.repeatIndex = (this.repeatIndex + 1) % this.repeatOptions.length;
                const chosen = this.repeatOptions[this.repeatIndex];
                repeatTypeText.textContent = chosen;
                if (repeatTimeRow) {
                    repeatTimeRow.style.display = ['Никогда', 'Каждую минуту'].includes(chosen) ? 'none' : 'flex';
                }
            });
        }

        if (addReplyBtn && qInput && aInput) {
            addReplyBtn.addEventListener('click', () => {
                const q = qInput.value.trim();
                const a = aInput.value.trim();
                if (!q || !a) {
                    App.showToast('Заполните вопрос и ответ');
                    return;
                }
                this.currentQuickReplies.push({ question: q, answer: a });
                qInput.value = '';
                aInput.value = '';
                this.renderQuickReplies();
            });
        }

        if (addMediaBtn && createMediaInput) {
            addMediaBtn.addEventListener('click', () => {
                if (this.currentImages.length >= 11) {
                    App.showToast('Максимум 11 файлов');
                    return;
                }
                createMediaInput.click();
            });

            createMediaInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files || []);
                if (files.length === 0) return;

                const availableSlots = 11 - this.currentImages.length;
                if (availableSlots <= 0) {
                    App.showToast('Максимум 11 файлов');
                    return;
                }

                const processFiles = files.slice(0, availableSlots);
                for (const file of processFiles) {
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        const base64 = event.target.result;
                        const uploaded = await App.uploadMedia(base64);
                        if (uploaded && uploaded.url) {
                            this.currentImages.push({ url: uploaded.url, type: uploaded.type, filename: uploaded.filename });
                            this.renderImagesPreview();
                        }
                    };
                    reader.readAsDataURL(file);
                }
                createMediaInput.value = '';
            });
        }

        if (recipientAddRow) {
            recipientAddRow.addEventListener('click', () => {
                this.openRecipientModal();
            });
        }

        if (saveReminderBtn) {
            saveReminderBtn.addEventListener('click', async () => {
                const title = document.getElementById('create-title-input')?.value.trim();
                const description = document.getElementById('create-desc-input')?.value.trim();
                if (!title) {
                    App.showToast('Введите название напоминания');
                    return;
                }

                const sendNow = sendNowToggle.classList.contains('active');
                let scheduledTime = null;
                if (!sendNow) {
                    const chosenVal = document.getElementById('send-datetime-input')?.value;
                    const minStr = this.getMinDateTimeString();
                    if (!chosenVal || chosenVal < minStr) {
                        App.showToast('Укажите корректное будущее время отправки');
                        return;
                    }
                    scheduledTime = chosenVal;
                }

                const repeatType = repeatTypeText?.textContent || 'Никогда';
                const repeatTime = ['Никогда', 'Каждую минуту'].includes(repeatType) ? null : document.getElementById('repeat-time-input')?.value;

                const finalRecipients = [...this.selectedGroups];
                const sendToSelf = sendToSelfToggle?.classList.contains('active');
                if (sendToSelf) {
                    finalRecipients.push('Себе');
                }

                if (finalRecipients.length === 0) {
                    App.showToast('Выберите хотя бы одну группу или отправку себе');
                    return;
                }

                const payload = {
                    title,
                    description,
                    send_now: sendNow,
                    scheduled_time: scheduledTime,
                    repeat_type: repeatType,
                    repeat_time: repeatTime,
                    recipients: finalRecipients,
                    quick_replies: this.currentQuickReplies,
                    images: this.currentImages
                };

                if (App.editingReminderId) {
                    await App.updateReminder(App.editingReminderId, payload);
                    App.editingReminderId = null;
                    App.showToast('Напоминание обновлено');
                } else {
                    await App.saveReminder(payload);
                    App.showToast('Напоминание сохранено');
                }

                if (typeof HomeScreen !== 'undefined' && HomeScreen.loadData) {
                    HomeScreen.loadData();
                }

                App.showScreen('home');
            });
        }

        this.populateForm(null);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CreateScreen.init();
});
