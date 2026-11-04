const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 7680;
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'md', 'odt', 'ods', 'odp', 'zip']);

const CreateScreen = {
    currentQuickReplies: [],
    feedbackOptions: [],
    selectedGroups: [],
    selectedPeople: [],
    recipientGroups: [],
    recipientPeople: [],
    recipientFilter: 'all',
    recipientLoadError: null,
    recipientLoadRequestId: 0,
    sendToSelf: false,
    wizardActive: false,
    startedFromTemplate: false,
    wizardStep: 1,
    currentImages: [],
    editingSentReminder: false,
    feedbackEnabled: false,
    feedbackAllowFiles: false,

    repeatOptions: ['Никогда', 'Каждый день', 'Каждую неделю', 'Каждый месяц'],
    repeatIndex: 0,

    startWizard: async function(template = null) {
        this.wizardActive = true;
        this.startedFromTemplate = Boolean(template);
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
            templates.forEach(template => addOption(template.title || 'Без названия', template.description || '', template));
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

    discardNewAttachments: function() {
        const newFiles = this.currentImages.filter(item => item && item.isNew && item.filename);
        this.currentImages = [];
        newFiles.forEach(item => App.deleteUploadedMedia(item.filename).catch(() => {}));
        this.renderImagesPreview();
    },

    backWizard: function() {
        if (!this.wizardActive) {
            this.discardNewAttachments();
            App.showScreen('home');
            return;
        }
        if (this.wizardStep === 3) {
            this.showWizardStep(2);
            return;
        }
        if (this.wizardStep === 2) {
            if (this.editingSentReminder || this.startedFromTemplate) {
                this.wizardActive = false;
                this.startedFromTemplate = false;
                this.editingSentReminder = false;
                App.editingReminderId = null;
                this.discardNewAttachments();
                App.showScreen('home');
                return;
            }
            this.showWizardStep(1);
            return;
        }
        this.discardNewAttachments();
        App.showScreen('home');
    },

    loadRecipientOptions: async function() {
        this.recipientLoadRequestId = (Number(this.recipientLoadRequestId) || 0) + 1;
        const requestId = this.recipientLoadRequestId;
        const listIds = ['wizard-recipients-list'];
        listIds.forEach(id => {
            const list = document.getElementById(id);
            if (list) list.textContent = 'Загружаем получателей...';
        });
        this.recipientLoadError = null;

        const selfOption = document.getElementById('wizard-self-option');
        if (selfOption) {
            selfOption.classList.toggle('selected', this.sendToSelf);
            selfOption.setAttribute('aria-pressed', String(this.sendToSelf));
        }
        const selfToggle = document.getElementById('send-to-self-toggle');
        if (selfToggle) selfToggle.classList.toggle('active', this.sendToSelf);
        this.updateRecipientsBadge(this.selectedGroups.length + this.selectedPeople.length + (this.sendToSelf ? 1 : 0));

        let timeoutIds = [];
        const withTimeout = (promise, label) => {
            let timeoutId;
            const timeout = new Promise((resolve, reject) => {
                timeoutId = setTimeout(() => reject(new Error(label + ': превышено время ожидания')), 12000);
                timeoutIds.push(timeoutId);
            });
            return Promise.race([promise, timeout]).finally(() => {
                clearTimeout(timeoutId);
                timeoutIds = timeoutIds.filter(id => id !== timeoutId);
            });
        };

        try {
            const groups = await withTimeout(App.getGroups(), 'Загрузка групп');
            if (requestId !== this.recipientLoadRequestId) return;
            const people = await withTimeout(App.getParticipants(), 'Загрузка участников');
            if (requestId !== this.recipientLoadRequestId) return;

            if (!Array.isArray(groups) || !Array.isArray(people)) {
                throw new Error('Сервер вернул некорректный список получателей');
            }

            this.recipientGroups = groups;
            this.recipientPeople = people;
            const groupNames = new Set(groups.map(group => String(group.name || '')));
            const personIds = new Set(people.map(person => String(person.id)));
            this.selectedGroups = this.selectedGroups.filter(name => groupNames.has(name));
            this.selectedPeople = this.selectedPeople.filter(id => personIds.has(String(id)));
            this.renderSelectedRecipients();
        } catch (error) {
            if (requestId !== this.recipientLoadRequestId) return;
            this.recipientGroups = [];
            this.recipientPeople = [];
            this.recipientLoadError = 'Не удалось загрузить получателей: ' + (error.message || 'ошибка сервера');
            this.renderSelectedRecipients();
            App.showToast(this.recipientLoadError);
        } finally {
            timeoutIds.forEach(clearTimeout);
            if (requestId === this.recipientLoadRequestId) {
                const wizardList = document.getElementById('wizard-recipients-list');
                if (wizardList?.textContent === 'Загружаем получателей...') {
                    this.recipientLoadError = this.recipientLoadError || 'Не удалось отобразить список получателей. Попробуйте открыть шаг ещё раз';
                    this.renderSelectedRecipients();
                }
            }
        }
    },

    renderRecipientChoices: function(listId, searchId) {
        const list = document.getElementById(listId);
        if (!list) return;
        if (this.recipientLoadError) {
            list.textContent = this.recipientLoadError;
            return;
        }
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

        if (this.recipientFilter === 'all' || this.recipientFilter === 'groups') this.recipientGroups.forEach(group => {
            const name = String(group.name || '');
            if (!name.toLocaleLowerCase().includes(query)) return;
            addChoice(name, (group.participant_count || 0) + ' участников', this.selectedGroups.includes(name), 'group', group.id);
        });

        if (this.recipientFilter === 'all' || this.recipientFilter === 'people') this.recipientPeople.forEach(person => {
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
        const selfOption = document.getElementById('wizard-self-option');
        if (selfOption) {
            selfOption.classList.toggle('selected', this.sendToSelf);
            selfOption.setAttribute('aria-pressed', String(this.sendToSelf));
        }

        this.renderRecipientChoices('wizard-recipients-list', 'wizard-recipient-search');
        this.renderRecipientSummary();
        document.querySelectorAll('[data-recipient-filter]').forEach(button => {
            const active = button.getAttribute('data-recipient-filter') === this.recipientFilter;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        this.updateRecipientsBadge(this.selectedGroups.length + this.selectedPeople.length + (this.sendToSelf ? 1 : 0));
    },

    renderRecipientSummary: function() {
        const summary = document.getElementById('details-recipients-summary');
        if (!summary) return;
        summary.innerHTML = '';

        const addLine = (name, detail) => {
            const item = document.createElement('div');
            item.className = 'recipient-summary-item';
            const title = document.createElement('strong');
            title.textContent = name;
            const subtitle = document.createElement('small');
            subtitle.textContent = detail;
            item.append(title, subtitle);
            summary.appendChild(item);
        };

        if (this.sendToSelf) addLine('Себе', 'Личное сообщение');
        this.selectedGroups.forEach(name => addLine(name, 'Группа'));
        this.selectedPeople.forEach(id => {
            const person = this.recipientPeople.find(item => String(item.id) === String(id));
            addLine(person?.name || 'Участник', 'Отдельный участник');
        });

        if (!summary.children.length) {
            const empty = document.createElement('div');
            empty.className = 'recipient-summary-empty';
            empty.textContent = 'Получатели не выбраны';
            summary.appendChild(empty);
        }
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

    getImageDimensions: async function(file) {
        if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(file);
            const dimensions = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
            return dimensions;
        }
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve({ width: image.naturalWidth, height: image.naturalHeight });
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Не удалось прочитать изображение'));
            };
            image.src = objectUrl;
        });
    },

    uploadAttachmentFile: async function(file, pendingItem) {
        try {
            if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Каждый файл должен быть не больше 10 МБ');
            const extension = String(file.name || '').split('.').pop().toLowerCase();
            const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension);
            if (!isImage && !SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
                throw new Error('Этот формат файла не поддерживается');
            }
            if (isImage) {
                const dimensions = await this.getImageDimensions(file);
                if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
                    throw new Error('Размер фото не должен превышать 7680 × 7680 пикселей');
                }
                if (dimensions.width < 1 || dimensions.height < 1) throw new Error('Не удалось определить размер изображения');
            }
            pendingItem.type = isImage ? 'image' : 'file';
            const uploaded = await App.uploadAttachment(file, progress => {
                pendingItem.progress = progress;
                this.renderImagesPreview();
            });
            const index = this.currentImages.indexOf(pendingItem);
            if (index === -1) {
                if (uploaded.filename) await App.deleteUploadedMedia(uploaded.filename).catch(() => {});
                return;
            }
            this.currentImages.splice(index, 1, { ...uploaded, isNew: true });
            this.renderImagesPreview();
        } catch (error) {
            const index = this.currentImages.indexOf(pendingItem);
            if (index !== -1) this.currentImages.splice(index, 1);
            this.renderImagesPreview();
            App.showToast(error.message || 'Не удалось загрузить файл');
        }
    },

    formatAttachmentSize: function(bytes) {
        const size = Number(bytes) || 0;
        if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1).replace('.', ',') + ' МБ';
        return Math.max(1, Math.round(size / 1024)) + ' КБ';
    },

    renderImagesPreview: function() {
        const grids = [
            { id: 'photo-preview-grid', type: 'image' },
            { id: 'document-preview-grid', type: 'file' }
        ];
        grids.forEach(({ id, type }) => {
            const grid = document.getElementById(id);
            if (!grid) return;
            grid.replaceChildren();
            this.currentImages.forEach((item, index) => {
                if ((item.type || 'file') !== type) return;
                const thumb = document.createElement('div');
                thumb.className = 'image-preview-thumb attachment-preview-thumb';
                if (item.pending) {
                    thumb.classList.add('attachment-upload-thumb');
                    const progress = Math.max(0, Math.min(100, Number(item.progress) || 0));
                    thumb.innerHTML = `
                        <div class="attachment-upload-progress">
                            <svg viewBox="0 0 48 48" aria-hidden="true">
                                <circle class="attachment-upload-track" cx="24" cy="24" r="20"></circle>
                                <circle class="attachment-upload-value" cx="24" cy="24" r="20" style="stroke-dashoffset: ${125.66 * (1 - progress / 100)}"></circle>
                            </svg>
                            <span>${progress}%</span>
                        </div>
                        <div class="attachment-preview-name">${App.escapeHtml(item.name)}</div>
                        <div class="attachment-preview-size">${this.formatAttachmentSize(item.size)}</div>
                    `;
                } else if (type === 'image') {
                    const image = document.createElement('img');
                    image.src = item.url || '';
                    image.alt = item.name || 'Фото';
                    image.loading = 'lazy';
                    thumb.appendChild(image);
                    const name = document.createElement('div');
                    name.className = 'attachment-preview-name';
                    name.textContent = item.name || 'Фото';
                    thumb.appendChild(name);
                } else {
                    thumb.classList.add('attachment-file-thumb');
                    thumb.innerHTML = `
                        <div class="attachment-file-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M6 2.75h8l4.5 4.5v14H6z"></path><path d="M14 2.75v5h4.5M9 13h6M9 16h6"></path></svg>
                        </div>
                        <div class="attachment-preview-name">${App.escapeHtml(item.name || 'Файл')}</div>
                        <div class="attachment-preview-size">${this.formatAttachmentSize(item.size)}</div>
                    `;
                }
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'image-preview-del';
                removeButton.setAttribute('aria-label', 'Удалить вложение');
                removeButton.textContent = '✕';
                removeButton.addEventListener('click', event => {
                    event.stopPropagation();
                    const removed = this.currentImages[index];
                    this.currentImages.splice(index, 1);
                    this.renderImagesPreview();
                    if (removed && removed.isNew && removed.filename) {
                        App.deleteUploadedMedia(removed.filename).catch(error => App.showToast(error.message));
                    }
                });
                thumb.appendChild(removeButton);
                grid.appendChild(thumb);
            });
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
        const headerTitle = document.querySelector('#create-screen .create-title');
        const saveBtn = document.getElementById('save-reminder-btn');
        const feedbackSection = document.getElementById('feedback-settings-section');
        if (feedbackSection) feedbackSection.style.display = 'none';
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
        this.renderSenderProfile();
        this.currentQuickReplies = Array.isArray(reminder.quick_replies) ? [...reminder.quick_replies] : [];
        this.feedbackOptions = [];
        this.feedbackEnabled = false;
        this.feedbackAllowFiles = false;
        const savedMedia = Array.isArray(reminder.images) ? reminder.images : [];
        this.currentImages = [
            ...savedMedia.filter(image => image && image.type === 'image' && typeof image.url === 'string').slice(0, 3),
            ...savedMedia.filter(image => image && image.type === 'file' && typeof image.url === 'string').slice(0, 3)
        ];

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
        this.renderFeedbackQuestions();
        this.renderSelectedRecipients();
        this.loadRecipientOptions();
        this.renderImagesPreview();
    },

    populateForSentEdit: function(reminder) {
        this.recipientFilter = 'all';
        const recipientSearch = document.getElementById('wizard-recipient-search');
        if (recipientSearch) recipientSearch.value = '';

        this.populateForEdit({
            ...reminder,
            send_now: 1,
            scheduled_time: null,
            repeat_type: 'Никогда',
            repeat_time: null
        });
        this.editingSentReminder = true;
        this.wizardActive = true;
        this.showWizardStep(2);

        const sendNowToggle = document.getElementById('send-now-toggle');
        const sendNowSection = sendNowToggle?.closest('.create-section');
        const repeatSection = document.getElementById('repeat-type-btn')?.closest('.create-section');
        const sendTimeRow = document.getElementById('send-time-picker-row');
        if (sendNowSection) sendNowSection.style.display = 'none';
        if (repeatSection) repeatSection.style.display = 'none';
        if (sendNowToggle) sendNowToggle.classList.add('active');
        if (sendTimeRow) sendTimeRow.style.display = 'none';
        const headerTitle = document.querySelector('#create-screen .create-title');
        if (headerTitle) headerTitle.textContent = 'Изменение сообщения';
        const saveBtn = document.getElementById('save-reminder-btn');
        if (saveBtn) saveBtn.childNodes[0].nodeValue = 'Сохранить изменения ';
    },

    renderSenderProfile: function() {
        const preview = document.getElementById('create-sender-profile');
        if (!preview) return;
        const user = window.WebApp?.initDataUnsafe?.user || {};
        const name = [user.first_name, user.last_name].filter(value => typeof value === 'string' && value.trim()).join(' ')
            || (typeof user.username === 'string' ? user.username : '');
        preview.textContent = name || 'Имя не указано';
    },

    populateForm: function(template) {
        this.editingSentReminder = false;
        this.feedbackEnabled = false;
        this.feedbackAllowFiles = false;
        this.feedbackOptions = [];
        App.editingReminderId = null;
        const titleInput = document.getElementById('create-title-input');
        const descInput = document.getElementById('create-desc-input');
        const sendNowToggle = document.getElementById('send-now-toggle');
        const sendTimeRow = document.getElementById('send-time-picker-row');
        const sendDateTime = document.getElementById('send-datetime-input');
        const repeatTimeRow = document.getElementById('repeat-time-picker-row');
        const repeatTypeText = document.getElementById('repeat-type-text');
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
            this.feedbackOptions = Array.isArray(template.feedback_options) ? [...template.feedback_options] : [];
        } else {
            if (titleInput) titleInput.value = '';
            if (descInput) descInput.value = '';
            this.currentQuickReplies = [];
            this.feedbackOptions = [];
        }

        this.renderSenderProfile();
        this.currentImages = [];

        if (sendNowToggle) {
            sendNowToggle.classList.add('active');
        }
        this.sendToSelf = false;
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
        this.selectedPeople = [];
        this.recipientFilter = 'all';
        const recipientSearch = document.getElementById('wizard-recipient-search');
        if (recipientSearch) recipientSearch.value = '';
        this.renderQuickReplies();
        this.renderFeedbackQuestions();
        this.renderSelectedRecipients();
        this.renderImagesPreview();
        this.renderFeedbackSettings();
    },

    renderFeedbackSettings: function() {
        const enabled = document.getElementById('feedback-enabled-toggle');
        const files = document.getElementById('feedback-files-toggle');
        const options = document.getElementById('feedback-settings-options');
        const section = document.getElementById('feedback-settings-section');
        const isNewSingle = !App.editingReminderId && !this.editingSentReminder;
        if (section) section.style.display = isNewSingle && this.repeatIndex === 0 ? 'block' : 'none';
        if (enabled) {
            enabled.classList.toggle('active', this.feedbackEnabled);
            enabled.setAttribute('aria-checked', String(this.feedbackEnabled));
        }
        if (files) {
            files.classList.toggle('active', this.feedbackAllowFiles);
            files.setAttribute('aria-checked', String(this.feedbackAllowFiles));
        }
        if (options) options.hidden = !this.feedbackEnabled;
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

    renderFeedbackQuestions: function() {
        const list = document.getElementById('feedback-options-list');
        if (!list) return;
        list.replaceChildren();

        this.feedbackOptions.forEach((question, index) => {
            const row = document.createElement('div');
            row.className = 'feedback-question-editor-row';
            const text = document.createElement('span');
            text.className = 'feedback-question-editor-text';
            text.textContent = question;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'feedback-question-editor-remove';
            remove.setAttribute('aria-label', 'Удалить вариант');
            remove.textContent = '×';
            remove.addEventListener('click', () => {
                this.feedbackOptions.splice(index, 1);
                this.renderFeedbackQuestions();
            });
            row.append(text, remove);
            list.appendChild(row);
        });
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
        const feedbackOptionInput = document.getElementById('feedback-option-input');
        const addFeedbackOptionBtn = document.getElementById('feedback-option-add-btn');
        const saveReminderBtn = document.getElementById('save-reminder-btn');
        const addPhotoBtn = document.getElementById('add-photo-btn');
        const photoInput = document.getElementById('create-photo-input');
        const addDocumentBtn = document.getElementById('add-document-btn');
        const documentInput = document.getElementById('create-document-input');

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

        const wizardSelfOption = document.getElementById('wizard-self-option');
        if (wizardSelfOption) {
            wizardSelfOption.addEventListener('click', () => {
                this.sendToSelf = !this.sendToSelf;
                wizardSelfOption.classList.toggle('selected', this.sendToSelf);
                wizardSelfOption.setAttribute('aria-pressed', String(this.sendToSelf));
                this.updateRecipientsBadge(this.selectedGroups.length + this.selectedPeople.length + (this.sendToSelf ? 1 : 0));
            });
        }

        document.querySelectorAll('[data-recipient-filter]').forEach(button => {
            button.addEventListener('click', () => {
                this.recipientFilter = button.getAttribute('data-recipient-filter') || 'all';
                this.renderSelectedRecipients();
            });
        });

        const recipientSearch = document.getElementById('wizard-recipient-search');
        if (recipientSearch) recipientSearch.addEventListener('input', () => this.renderSelectedRecipients());

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
                if (chosen !== 'Никогда') {
                    this.feedbackEnabled = false;
                    this.feedbackAllowFiles = false;
                }
                this.renderFeedbackSettings();
            });
        }

        const bindFeedbackToggle = (element, property, dependent) => {
            if (!element) return;
            const toggle = () => {
                this[property] = !this[property];
                if (dependent && !this[property]) this.feedbackAllowFiles = false;
                this.renderFeedbackSettings();
            };
            element.addEventListener('click', toggle);
            element.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
            });
        };
        bindFeedbackToggle(document.getElementById('feedback-enabled-toggle'), 'feedbackEnabled', true);
        bindFeedbackToggle(document.getElementById('feedback-files-toggle'), 'feedbackAllowFiles', false);

        if (addFeedbackOptionBtn && feedbackOptionInput) {
            addFeedbackOptionBtn.addEventListener('click', () => {
                const option = feedbackOptionInput.value.trim();
                if (!option) {
                    App.showToast('Введите вариант ответа');
                    return;
                }
                if (this.feedbackOptions.length >= 20) {
                    App.showToast('Можно добавить не более 20 вариантов');
                    return;
                }
                if (this.feedbackOptions.some(item => item.toLocaleLowerCase() === option.toLocaleLowerCase())) {
                    App.showToast('Такой вариант уже добавлен');
                    return;
                }
                this.feedbackOptions.push(option.slice(0, 200));
                feedbackOptionInput.value = '';
                this.renderFeedbackQuestions();
            });
            feedbackOptionInput.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    addFeedbackOptionBtn.click();
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

        const bindAttachmentPicker = (button, input, type) => {
            if (!button || !input) return;
            const getCount = () => this.currentImages.filter(item => item.type === type || (!item.type && type === 'file')).length;
            button.addEventListener('click', () => {
                if (getCount() >= 3) {
                    App.showToast(type === 'image' ? 'Можно добавить максимум 3 фото' : 'Можно добавить максимум 3 документа');
                    return;
                }
                input.click();
            });
            input.addEventListener('change', event => {
                const files = Array.from(event.target.files || []);
                if (!files.length) return;
                const availableSlots = 3 - getCount();
                if (files.length > availableSlots) App.showToast(type === 'image' ? 'Можно добавить максимум 3 фото' : 'Можно добавить максимум 3 документа');
                files.slice(0, availableSlots).forEach(file => {
                    const pending = {
                        pending: true,
                        type,
                        progress: 0,
                        name: file.name || (type === 'image' ? 'Фото' : 'Файл'),
                        size: file.size || 0
                    };
                    this.currentImages.push(pending);
                    this.renderImagesPreview();
                    this.uploadAttachmentFile(file, pending);
                });
                input.value = '';
            });
        };
        bindAttachmentPicker(addPhotoBtn, photoInput, 'image');
        bindAttachmentPicker(addDocumentBtn, documentInput, 'file');

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

                if (this.currentImages.some(item => item.pending)) {
                    App.showToast('Дождитесь окончания загрузки вложений');
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
                    feedback_options: !App.editingReminderId && repeatType === 'Никогда' && this.feedbackEnabled ? this.feedbackOptions : [],
                    feedback_enabled: !App.editingReminderId && repeatType === 'Никогда' && this.feedbackEnabled,
                    feedback_allow_files: !App.editingReminderId && repeatType === 'Никогда' && this.feedbackEnabled && this.feedbackAllowFiles,
                    images: this.currentImages.map(({ isNew, ...item }) => item)
                };

                try {
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
                } catch (error) {
                    App.showToast(error.message || 'Не удалось сохранить напоминание');
                    return;
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
