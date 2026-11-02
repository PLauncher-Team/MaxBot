const CreateScreen = {
    currentQuickReplies: [],
    selectedGroups: [],
    selectedPeople: [],
    recipientGroups: [],
    recipientPeople: [],
    sendToSelf: true,
    wizardActive: false,
    wizardStep: 1,
    currentImages: [],
    editingSentReminder: false,

    repeatOptions: ['Никогда', 'Каждый день', 'Каждую неделю', 'Каждый месяц'],
    repeatIndex: 0,

    startWizard: async function(template = null) {
        this.wizardActive = true;
        this.editingSentReminder = false;
        App.editingReminderId = null;
        this.populateForm(template);
        App.showScreen('create');
        if (template) {
            this.showWizardStep(2);
            await this.loadRecipientOptions();
        } else {
            this.showWizardStep(1);
            await this.renderTemplateOptions();
        }
    },

    renderTemplateOptions: async function() {
        const list = document.getElementById('wizard-template-options');
        if (!list) return;
        list.innerHTML = '';

        const addOption = (title, description, template, isEmpty = false) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'wizard-template-option' + (isEmpty ? ' wizard-template-option-empty' : '');
            const name = document.createElement('span');
            name.className = 'wizard-template-option-title';
            name.textContent = title;
            option.appendChild(name);
            if (description) {
                const detail = document.createElement('span');
                detail.className = 'wizard-template-option-description';
                detail.textContent = description;
                option.appendChild(detail);
            }
            option.addEventListener('click', () => this.selectWizardTemplate(template));
            list.appendChild(option);
        };

        addOption('Без шаблона', 'Создать напоминание с пустой формой', null, true);
        const loading = document.createElement('div');
        loading.className = 'wizard-template-loading';
        loading.textContent = 'Загрузка шаблонов...';
        list.appendChild(loading);

        try {
            const templates = await App.getTemplates();
            loading.remove();
            templates.forEach(template => addOption(template.title || 'Без названия', '', template));
        } catch (error) {
            loading.textContent = 'Не удалось загрузить шаблоны';
        }
    },

    selectWizardTemplate: async function(template) {
        this.populateForm(template);
        this.showWizardStep(2);
        await this.loadRecipientOptions();
    },

    showWizardStep: function(step) {
        this.wizardStep = step;
        const panels = {
            1: document.getElementById('reminder-step-template'),
            2: document.getElementById('reminder-step-recipients'),
            3: document.getElementById('reminder-step-details')
        };
        Object.entries(panels).forEach(([number, panel]) => {
            if (panel) panel.style.display = Number(number) === step ? 'block' : 'none';
        });

        const progress = document.getElementById('reminder-wizard-progress');
        if (progress) progress.style.display = this.wizardActive ? 'flex' : 'none';
        document.querySelectorAll('.reminder-wizard-progress-step').forEach(item => {
            const number = Number(item.getAttribute('data-wizard-step'));
            item.classList.toggle('active', number === step);
            item.classList.toggle('completed', number < step);
        });

        const stepBottom = document.getElementById('wizard-step-bottom');
        const detailsBottom = document.getElementById('details-step-bottom');
        if (stepBottom) stepBottom.style.display = this.wizardActive && step === 2 ? 'block' : 'none';
        if (detailsBottom) detailsBottom.style.display = step === 3 ? 'block' : 'none';

        const headerTitle = document.querySelector('#create-screen .create-title');
        if (headerTitle && !App.editingReminderId) {
            headerTitle.textContent = step === 1 ? 'Новое напоминание' : (step === 2 ? 'Получатели' : 'Детали напоминания');
        }

        const content = document.querySelector('#create-screen .create-content');
        if (content) content.scrollTop = 0;
        if (step === 3) this.renderSelectedRecipients();
    },

    backWizard: function() {
        if (!this.wizardActive) {
            App.showScreen('home');
            return;
        }
        if (this.wizardStep === 3) {
            this.showWizardStep(2);
            return;
        }
        if (this.wizardStep === 2) {
            this.showWizardStep(1);
            return;
        }
        App.showScreen('home');
    },

    loadRecipientOptions: async function() {
        const listIds = ['wizard-recipients-list', 'details-recipients-list'];
        listIds.forEach(id => {
            const list = document.getElementById(id);
            if (list) list.textContent = 'Загружаем получателей...';
        });

        const selfOption = document.getElementById('wizard-self-option');
        if (selfOption) {
            selfOption.classList.toggle('selected', this.sendToSelf);
            selfOption.setAttribute('aria-pressed', String(this.sendToSelf));
        }
        const selfToggle = document.getElementById('send-to-self-toggle');
        if (selfToggle) selfToggle.classList.toggle('active', this.sendToSelf);
        this.updateRecipientsBadge(this.selectedGroups.length + this.selectedPeople.length + (this.sendToSelf ? 1 : 0));

        const userId = App.getUserId();
        const readLocal = (key) => {
            try {
                const value = localStorage.getItem(key);
                const parsed = value ? JSON.parse(value) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                return [];
            }
        };

        let timeoutId;
        try {
            const timeout = new Promise((resolve, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Recipient loading timed out')), 8000);
            });
            const [groups, people] = await Promise.race([
                Promise.all([App.getGroups(), App.getParticipants()]),
                timeout
            ]);
            this.recipientGroups = Array.isArray(groups) ? groups : [];
            this.recipientPeople = Array.isArray(people) ? people : [];
        } catch (error) {
            this.recipientGroups = readLocal('maxapp_groups_' + userId);
            this.recipientPeople = readLocal('maxapp_participants_' + userId);
            App.showToast('Не удалось загрузить получателей с сервера. Показаны сохранённые данные');
        } finally {
            clearTimeout(timeoutId);
        }

        const groupNames = new Set(this.recipientGroups.map(group => String(group.name || '')));
        const personIds = new Set(this.recipientPeople.map(person => String(person.id)));
        this.selectedGroups = this.selectedGroups.filter(name => groupNames.has(name));
        this.selectedPeople = this.selectedPeople.filter(id => personIds.has(String(id)));
        this.renderSelectedRecipients();
    },

    renderRecipientChoices: function(listId, searchId) {
        const list = document.getElementById(listId);
        if (!list) return;
        const query = (document.getElementById(searchId)?.value || '').trim().toLocaleLowerCase();
        list.innerHTML = '';
        let visibleCount = 0;

        const addChoice = (name, detail, selected, type, id) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'wizard-recipient-option' + (selected ? ' selected' : '');
            option.setAttribute('aria-pressed', String(selected));

            const check = document.createElement('span');
            check.className = 'wizard-recipient-check';
            const copy = document.createElement('span');
            copy.className = 'wizard-recipient-option-copy';
            const title = document.createElement('strong');
            title.textContent = name;
            const subtitle = document.createElement('small');
            subtitle.textContent = detail;
            copy.append(title, subtitle);
            option.append(check, copy);

            option.addEventListener('click', () => {
                if (type === 'group') {
                    this.selectedGroups = selected
                        ? this.selectedGroups.filter(value => value !== name)
                        : [...this.selectedGroups, name];
                } else {
                    const personId = String(id);
                    this.selectedPeople = selected
                        ? this.selectedPeople.filter(value => value !== personId)
                        : [...this.selectedPeople, personId];
                }
                this.renderSelectedRecipients();
            });
            list.appendChild(option);
            visibleCount++;
        };

        this.recipientGroups.forEach(group => {
            const name = String(group.name || '');
            if (!name.toLocaleLowerCase().includes(query)) return;
            addChoice(name, (group.participant_count || 0) + ' участников', this.selectedGroups.includes(name), 'group', group.id);
        });

        this.recipientPeople.forEach(person => {
            const name = String(person.name || 'Участник');
            if (!name.toLocaleLowerCase().includes(query)) return;
            const groupNames = Array.isArray(person.groups) ? person.groups.map(group => group.name).filter(Boolean) : [];
            const detail = groupNames.length ? groupNames.join(', ') : 'Участник';
            addChoice(name, detail, this.selectedPeople.includes(String(person.id)), 'person', person.id);
        });

        if (visibleCount === 0) {
            const empty = document.createElement('div');
            empty.className = 'wizard-recipient-empty';
            empty.textContent = query ? 'Ничего не найдено' : 'Пока нет групп и участников';
            list.appendChild(empty);
        }
    },

    renderSelectedRecipients: function() {
        const sendToSelfToggle = document.getElementById('send-to-self-toggle');
        if (sendToSelfToggle) sendToSelfToggle.classList.toggle('active', this.sendToSelf);

        const selfOption = document.getElementById('wizard-self-option');
        if (selfOption) {
            selfOption.classList.toggle('selected', this.sendToSelf);
            selfOption.setAttribute('aria-pressed', String(this.sendToSelf));
        }

        this.renderRecipientChoices('wizard-recipients-list', 'wizard-recipient-search');
        this.renderRecipientChoices('details-recipients-list', 'details-recipient-search');
        this.updateRecipientsBadge(this.selectedGroups.length + this.selectedPeople.length + (this.sendToSelf ? 1 : 0));
    },

    updateRecipientsBadge: function(count) {
        const badge = document.getElementById('recipients-badge');
        if (badge) badge.textContent = count;
    },

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
        this.editingSentReminder = false;
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
        const sendNowSection = sendNowToggle?.closest('.create-section');
        const repeatSection = document.getElementById('repeat-type-btn')?.closest('.create-section');
        if (sendNowSection) sendNowSection.style.display = 'block';
        if (repeatSection) repeatSection.style.display = 'block';

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
            repeatTimeRow.style.display = this.repeatOptions[this.repeatIndex] === 'Никогда' ? 'none' : 'flex';
        }
        if (repeatTimeInput && reminder.repeat_time) {
            repeatTimeInput.value = reminder.repeat_time;
        }

        const recipients = Array.isArray(reminder.recipients) ? reminder.recipients : [];
        this.sendToSelf = recipients.includes('Себе');
        this.selectedPeople = recipients
            .filter(value => /^person:[0-9]+$/.test(value))
            .map(value => value.slice(7));
        this.selectedGroups = recipients.filter(value => value !== 'Себе' && !/^person:[0-9]+$/.test(value));
        this.wizardActive = false;
        this.showWizardStep(3);
        this.renderQuickReplies();
        this.renderSelectedRecipients();
        this.loadRecipientOptions();
        this.renderImagesPreview();
    },

    populateForSentEdit: function(reminder) {
        this.populateForEdit({
            ...reminder,
            send_now: 1,
            scheduled_time: null,
            repeat_type: 'Никогда',
            repeat_time: null
        });
        this.editingSentReminder = true;
        const sendNowToggle = document.getElementById('send-now-toggle');
        const sendNowSection = sendNowToggle?.closest('.create-section');
        const repeatSection = document.getElementById('repeat-type-btn')?.closest('.create-section');
        const sendTimeRow = document.getElementById('send-time-picker-row');
        if (sendNowSection) sendNowSection.style.display = 'none';
        if (repeatSection) repeatSection.style.display = 'none';
        if (sendNowToggle) sendNowToggle.classList.add('active');
        if (sendTimeRow) sendTimeRow.style.display = 'none';
        const headerTitle = document.querySelector('#create-screen .create-title');
        if (headerTitle) headerTitle.textContent = 'Изменение отправленного сообщения';
        const saveBtn = document.getElementById('save-reminder-btn');
        if (saveBtn) saveBtn.childNodes[0].nodeValue = 'Сохранить изменения ';
    },

    populateForm: function(template) {
        this.editingSentReminder = false;
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
        const sendNowSection = sendNowToggle?.closest('.create-section');
        const repeatSection = document.getElementById('repeat-type-btn')?.closest('.create-section');
        if (sendNowSection) sendNowSection.style.display = 'block';
        if (repeatSection) repeatSection.style.display = 'block';

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
        this.sendToSelf = true;
        if (sendToSelfToggle) sendToSelfToggle.classList.add('active');
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

        ['wizard-recipient-search', 'details-recipient-search'].forEach(id => {
            const search = document.getElementById(id);
            if (search) search.value = '';
        });

        this.selectedGroups = [];
        this.selectedPeople = [];
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
                this.sendToSelf = !this.sendToSelf;
                this.renderSelectedRecipients();
            });
        }

        const wizardSelfOption = document.getElementById('wizard-self-option');
        if (wizardSelfOption) {
            wizardSelfOption.addEventListener('click', () => {
                this.sendToSelf = !this.sendToSelf;
                wizardSelfOption.classList.toggle('selected', this.sendToSelf);
                wizardSelfOption.setAttribute('aria-pressed', String(this.sendToSelf));
                this.updateRecipientsBadge(this.selectedGroups.length + this.selectedPeople.length + (this.sendToSelf ? 1 : 0));
            });
        }

        ['wizard-recipient-search', 'details-recipient-search'].forEach(id => {
            const search = document.getElementById(id);
            if (search) search.addEventListener('input', () => this.renderSelectedRecipients());
        });

        const wizardNextBtn = document.getElementById('wizard-next-btn');
        if (wizardNextBtn) {
            wizardNextBtn.addEventListener('click', () => {
                const count = this.selectedGroups.length + this.selectedPeople.length + (this.sendToSelf ? 1 : 0);
                if (count === 0) {
                    App.showToast('Выберите хотя бы одного получателя');
                    return;
                }
                this.showWizardStep(3);
            });
        }

        const manageRecipientsBtn = document.getElementById('manage-recipients-btn');
        if (manageRecipientsBtn) {
            manageRecipientsBtn.addEventListener('click', () => {
                App.recipientsReturnScreen = 'create';
                App.showScreen('recipients');
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
                    repeatTimeRow.style.display = chosen === 'Никогда' ? 'none' : 'flex';
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

        if (saveReminderBtn) {
            saveReminderBtn.addEventListener('click', async () => {
                const title = document.getElementById('create-title-input')?.value.trim();
                const description = document.getElementById('create-desc-input')?.value.trim();
                if (!title) {
                    App.showToast('Введите название напоминания');
                    return;
                }

                const sendNow = this.editingSentReminder || sendNowToggle.classList.contains('active');
                let scheduledTime = null;
                if (!sendNow && !this.editingSentReminder) {
                    const chosenVal = document.getElementById('send-datetime-input')?.value;
                    const minStr = this.getMinDateTimeString();
                    if (!chosenVal || chosenVal < minStr) {
                        App.showToast('Укажите корректное будущее время отправки');
                        return;
                    }
                    scheduledTime = chosenVal;
                }

                const repeatType = this.editingSentReminder ? 'Никогда' : (repeatTypeText?.textContent || 'Никогда');
                const repeatTime = repeatType === 'Никогда' ? null : document.getElementById('repeat-time-input')?.value;

                const finalRecipients = [
                    ...this.selectedGroups,
                    ...this.selectedPeople.map(id => 'person:' + id)
                ];
                if (this.sendToSelf) finalRecipients.push('Себе');

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
                    repeat_time: this.editingSentReminder ? null : repeatTime,
                    recipients: finalRecipients,
                    quick_replies: this.currentQuickReplies,
                    images: this.currentImages
                };

                if (App.editingReminderId) {
                    const result = await App.updateReminder(App.editingReminderId, payload);
                    if (result && result.error) {
                        App.showToast(result.error);
                        return;
                    }
                    App.editingReminderId = null;
                    this.editingSentReminder = false;
                    this.wizardActive = false;
                    if (result && result.failed > 0) {
                        App.showToast('Обновлено не для всех получателей: ' + result.failed);
                    } else {
                        App.showToast('Напоминание обновлено');
                    }
                } else {
                    await App.saveReminder(payload);
                    this.wizardActive = false;
                    App.showToast('Напоминание сохранено');
                }

                if (typeof HomeScreen !== 'undefined' && HomeScreen.loadData) {
                    HomeScreen.loadData();
                }

                App.showScreen('home');
            });
        }

        const createBackBtn = document.getElementById('create-back-btn');
        if (createBackBtn) createBackBtn.addEventListener('click', () => this.backWizard());

        this.populateForm(null);
        this.showWizardStep(3);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CreateScreen.init();
});
