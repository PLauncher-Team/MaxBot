const App = {
    currentScreen: 'home',
    recipientsReturnScreen: null,

    screens: {},

    selectedTemplate: null,

    modalReplies: [],
    editingTemplateId: null,

    escapeHtml: function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    getFileExtension: function(fileName) {
        const normalized = String(fileName || '').split(/[?#]/, 1)[0].replace(/\\/g, '/');
        const baseName = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
        const match = baseName.match(/\.([a-z0-9]{1,10})$/);
        return match ? match[1] : '';
    },

    getFileIconType: function(fileName) {
        const extension = this.getFileExtension(fileName);
        if (extension === 'pdf') return 'pdf';
        if (['doc', 'docx', 'odt', 'rtf'].includes(extension)) return 'document';
        if (['xls', 'xlsx', 'ods', 'csv'].includes(extension)) return 'spreadsheet';
        if (['ppt', 'pptx', 'odp'].includes(extension)) return 'presentation';
        if (extension === 'zip') return 'archive';
        if (['txt', 'md'].includes(extension)) return 'text';
        return 'generic';
    },

    getAuthHeaders: function() {
        const initData = window.WebApp && typeof window.WebApp.initData === 'string'
            ? window.WebApp.initData
            : '';
        return initData ? { 'X-Webapp-Init-Data': initData } : {};
    },

    getUserId: function() {
        const userId = window.WebApp?.initDataUnsafe?.user?.id;
        return userId === undefined || userId === null ? null : String(userId);
    },

    isMaxApp: function() {
        return Boolean(
            window.WebApp &&
            typeof window.WebApp.initData === 'string' &&
            window.WebApp.initData.trim().length > 0
        );
    },

    showToast: function(message) {
        const toast = document.getElementById('toast-notification');
        const text = document.getElementById('toast-message');
        if (!toast || !text) return;
        text.textContent = message;
        toast.classList.add('visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('visible');
        }, 2800);
    },

    showScreen: function(screenName) {
        this.currentScreen = screenName;
        Object.values(this.screens).forEach(screen => {
            if (screen) {
                screen.classList.remove('active');
            }
        });
        if (this.screens[screenName]) {
            this.screens[screenName].classList.add('active');
        }

        if (window.WebApp && window.WebApp.BackButton) {
            if (screenName === 'home' || screenName === 'reminderView') {
                window.WebApp.BackButton.hide();
            } else {
                window.WebApp.BackButton.show();
            }
        }

        if (screenName === 'home' && typeof HomeScreen !== 'undefined' && typeof HomeScreen.refreshReminders === 'function') {
            HomeScreen.refreshReminders();
        }
    },

    getTemplates: async function() {
        const res = await fetch('/api/templates', {
            headers: this.getAuthHeaders()
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось загрузить шаблоны');
        }
        if (!Array.isArray(data)) {
            throw new Error('Сервер вернул некорректный список шаблонов');
        }
        return data;
    },

    saveTemplate: async function(template) {
        const res = await fetch('/api/templates', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify(template)
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось сохранить шаблон');
        }
        return data;
    },

    updateTemplate: async function(id, template) {
        const res = await fetch('/api/templates/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify(template)
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось обновить шаблон');
        }
        return data;
    },

    deleteTemplate: async function(id) {
        const response = await fetch('/api/templates/' + id, {
            method: 'DELETE',
            headers: this.getAuthHeaders()
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || 'Не удалось удалить шаблон');
        }

        return data;
    },

    getFeedback: async function(id) {
        const response = await fetch('/api/reminders/' + encodeURIComponent(id) + '/feedback', { headers: this.getAuthHeaders() });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Не удалось загрузить обратную связь');
        return data;
    },

    getFeedbackExport: async function(id) {
        const response = await fetch('/api/reminders/' + encodeURIComponent(id) + '/feedback/export', {
            headers: this.getAuthHeaders()
        });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error || 'Не удалось экспортировать ответы');
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        const plainName = disposition.match(/filename="([^"]+)"/i);
        const filename = encodedName
            ? decodeURIComponent(encodedName[1])
            : (plainName ? plainName[1] : 'feedback.xlsx');
        return { blob: await response.blob(), filename };
    },

    markFeedbackRead: async function(id, lastSeenSubmissionId) {
        const response = await fetch('/api/reminders/' + encodeURIComponent(id) + '/feedback/read', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify({ last_seen_submission_id: Number(lastSeenSubmissionId) || 0 })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Не удалось отметить обратную связь просмотренной');
        return data;
    },

    markRecipientQuestionsRead: async function(id, lastSeenQuestionId) {
        const response = await fetch('/api/reminders/' + encodeURIComponent(id) + '/questions/read', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify({ last_seen_question_id: Number(lastSeenQuestionId) || 0 })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Не удалось отметить вопросы просмотренными');
        return data;
    },

    answerRecipientQuestion: async function(id, questionId, answer) {
        const response = await fetch('/api/reminders/' + encodeURIComponent(id) + '/questions/' + encodeURIComponent(questionId) + '/answer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify({ answer })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Не удалось отправить ответ');
        return data;
    },

    deleteRecipientQuestion: async function(id, questionId) {
        const response = await fetch('/api/reminders/' + encodeURIComponent(id) + '/questions/' + encodeURIComponent(questionId), {
            method: 'DELETE',
            headers: this.getAuthHeaders()
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Не удалось удалить вопрос');
        return data;
    },

    getReminders: async function() {
        const res = await fetch('/api/reminders', {
            headers: this.getAuthHeaders()
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось загрузить напоминания');
        }
        if (!Array.isArray(data)) {
            throw new Error('Сервер вернул некорректный список напоминаний');
        }
        return data;
    },

    deleteReminder: async function(id) {
        try {
            const res = await fetch('/api/reminders/' + id, {
                method: 'DELETE',
                headers: this.getAuthHeaders()
            });
            const data = await res.json();
            if (!res.ok) {
                return { error: data.error || 'Не удалось удалить напоминание' };
            }
            return data;
        } catch (e) {
            return { error: 'Не удалось связаться с сервером' };
        }
    },

    updateReminder: async function(id, reminder) {
        try {
            const res = await fetch('/api/reminders/' + id, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify(reminder)
            });
            const data = await res.json();
            if (!res.ok) {
                return { error: data.error || 'Не удалось обновить напоминание' };
            }
            return data;
        } catch (e) {
            return { error: 'Не удалось связаться с сервером' };
        }
    },

    uploadMedia: async function(mediaData) {
        try {
            const res = await fetch('/api/reminders/upload-media', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ media_data: mediaData })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}
        return null;
    },

    uploadImage: async function(imageData) {
        try {
            const res = await fetch('/api/reminders/upload-image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ image_data: imageData })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}
        return null;
    },

    uploadAttachment: function(file, onProgress) {
        return new Promise((resolve, reject) => {
            const extension = String(file.name || '').split('.').pop().toLowerCase();
            const imageMimeTypes = {
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                gif: 'image/gif',
                webp: 'image/webp'
            };
            const isImage = Object.prototype.hasOwnProperty.call(imageMimeTypes, extension);
            const endpoint = isImage ? '/api/reminders/upload-media' : '/api/reminders/upload-file';
            const reader = new FileReader();

            reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
            reader.onprogress = event => {
                if (event.lengthComputable && typeof onProgress === 'function') {
                    onProgress(Math.round(event.loaded / event.total * 25));
                }
            };
            reader.onload = () => {
                const dataUrl = String(reader.result || '').replace(/^data:[^;,]+/, 'data:' + (imageMimeTypes[extension] || file.type || 'application/octet-stream'));
                const xhr = new XMLHttpRequest();
                xhr.open('POST', endpoint, true);
                xhr.timeout = 120000;
                xhr.setRequestHeader('Content-Type', 'application/json');
                Object.entries(this.getAuthHeaders()).forEach(([name, value]) => {
                    if (value) xhr.setRequestHeader(name, value);
                });
                xhr.upload.addEventListener('progress', event => {
                    if (event.lengthComputable && typeof onProgress === 'function') {
                        onProgress(25 + Math.round(event.loaded / event.total * 75));
                    }
                });
                xhr.onload = () => {
                    let data;
                    try {
                        data = JSON.parse(xhr.responseText || '{}');
                    } catch (error) {
                        reject(new Error('Сервер вернул некорректный ответ'));
                        return;
                    }
                    if (xhr.status < 200 || xhr.status >= 300) {
                        reject(new Error(data.error || 'Не удалось загрузить файл'));
                        return;
                    }
                    if (typeof onProgress === 'function') onProgress(100);
                    resolve(data);
                };
                xhr.onerror = () => reject(new Error('Не удалось связаться с сервером'));
                xhr.ontimeout = () => reject(new Error('Время загрузки файла истекло'));
                xhr.onabort = () => reject(new Error('Загрузка отменена'));
                xhr.send(JSON.stringify({ media_data: dataUrl, file_name: file.name }));
            };
            reader.readAsDataURL(file);
        });
    },

    deleteUploadedMedia: async function(filename) {
        const res = await fetch('/api/reminders/uploads/' + encodeURIComponent(filename), {
            method: 'DELETE',
            headers: this.getAuthHeaders()
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось удалить файл');
        }
        return data;
    },

    getBotInfo: async function() {
        const res = await fetch('/api/bot-info', {
            headers: this.getAuthHeaders()
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось получить информацию о боте');
        }
        if (!data || typeof data.username !== 'string' || !data.username) {
            throw new Error('Сервер вернул некорректную информацию о боте');
        }
        return data;
    },

    getGroups: async function() {
        const res = await fetch('/api/groups', {
            headers: this.getAuthHeaders()
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось загрузить группы');
        }
        if (!Array.isArray(data)) {
            throw new Error('Сервер вернул некорректный список групп');
        }
        return data;
    },

    saveGroup: async function(name) {
        const res = await fetch('/api/groups', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify({ name })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось создать группу');
        }
        return data;
    },

    deleteGroup: async function(id) {
        const response = await fetch('/api/groups/' + id, {
            method: 'DELETE',
            headers: this.getAuthHeaders()
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || 'Не удалось удалить группу');
        }
        return data;
    },

    getParticipants: async function() {
        const res = await fetch('/api/participants', {
            headers: this.getAuthHeaders()
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось загрузить участников');
        }
        if (!Array.isArray(data)) {
            throw new Error('Сервер вернул некорректный список участников');
        }
        return data;
    },

    deleteParticipant: async function(id) {
        const response = await fetch('/api/participants/' + id, {
            method: 'DELETE',
            headers: this.getAuthHeaders()
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || 'Не удалось удалить участника');
        }
        return data;
    },

    addParticipantsToGroups: async function(participantIds, groupIds) {
        const response = await fetch('/api/participants/batch-group', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify({ participant_ids: participantIds, group_ids: groupIds })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || 'Не удалось добавить участников в группы');
        }
        return data;
    },

    removeParticipantFromGroup: async function(participantId, groupId) {
        const response = await fetch('/api/participants/' + participantId + '/groups/' + groupId, {
            method: 'DELETE',
            headers: this.getAuthHeaders()
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || 'Не удалось убрать участника из группы');
        }
        return data;
    },

    joinGroup: async function(uniqueId) {
        let userName = 'Участник';
        if (window.WebApp && window.WebApp.initDataUnsafe && window.WebApp.initDataUnsafe.user) {
            const u = window.WebApp.initDataUnsafe.user;
            userName = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;
        }

        try {
            const res = await fetch('/api/join-group', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ unique_id: uniqueId, user_name: userName })
            });
            if (res.ok) {
                const data = await res.json();
                if (!data.already_joined) {
                    this.showToast('Вы присоединились к группе: ' + data.group_name);
                }
            }
        } catch (e) {}
    },

    saveReminder: async function(reminder) {
        const res = await fetch('/api/reminders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            },
            body: JSON.stringify(reminder)
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось сохранить напоминание');
        }
        return data;
    },

    renderModalReplies: function() {
        const list = document.getElementById('modal-replies-list');
        if (!list) return;
        list.innerHTML = '';
        this.modalReplies.forEach((r, idx) => {
            const card = document.createElement('div');
            card.className = 'modal-reply-card';
            card.innerHTML = `
                <div class="modal-reply-content">
                    <span class="modal-reply-q">${this.escapeHtml(r.question)}</span>
                    <span class="modal-reply-a">${this.escapeHtml(r.answer)}</span>
                </div>
                <button type="button" class="modal-reply-del" data-idx="${idx}">
                    <svg width="12" height="12" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            `;
            list.appendChild(card);
        });
        list.querySelectorAll('.modal-reply-del').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.getAttribute('data-idx'), 10);
                this.modalReplies.splice(i, 1);
                this.renderModalReplies();
            });
        });
    },

    renderModalFeedbackOptions: function() {
        const list = document.getElementById('modal-feedback-options-list');
        if (!list) return;
        list.replaceChildren();
        (this.modalFeedbackOptions || []).forEach((option, index) => {
            const row = document.createElement('div');
            row.className = 'feedback-question-editor-row';
            const label = document.createElement('span');
            label.className = 'feedback-question-editor-text';
            label.textContent = option;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'feedback-question-editor-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', 'Удалить вариант');
            remove.addEventListener('click', () => {
                this.modalFeedbackOptions.splice(index, 1);
                this.renderModalFeedbackOptions();
            });
            row.append(label, remove);
            list.appendChild(row);
        });
    },

    openCreateTemplateModal: function() {
        const modal = document.getElementById('template-modal');
        const titleInput = document.getElementById('modal-template-title');
        const descInput = document.getElementById('modal-template-desc');
        const qInput = document.getElementById('modal-reply-q');
        const aInput = document.getElementById('modal-reply-a');
        const heading = document.getElementById('modal-template-heading');
        const saveButton = document.getElementById('modal-template-save');
        this.editingTemplateId = null;
        if (titleInput) titleInput.value = '';
        if (descInput) descInput.value = '';
        if (qInput) qInput.value = '';
        if (aInput) aInput.value = '';
        if (heading) heading.textContent = 'Новый шаблон';
        if (saveButton) saveButton.textContent = 'Создать шаблон';
        this.modalReplies = [];
        this.modalFeedbackOptions = [];
        this.modalFeedbackEnabled = false;
        this.modalFeedbackAllowFiles = false;
        this.renderModalFeedbackSettings();
        const optionInput = document.getElementById('modal-feedback-option-input');
        if (optionInput) optionInput.value = '';
        this.renderModalReplies();
        this.renderModalFeedbackOptions();
        if (modal) modal.style.display = 'flex';
    },

    openEditTemplateModal: function(template) {
        const modal = document.getElementById('template-modal');
        const titleInput = document.getElementById('modal-template-title');
        const descInput = document.getElementById('modal-template-desc');
        const qInput = document.getElementById('modal-reply-q');
        const aInput = document.getElementById('modal-reply-a');
        const heading = document.getElementById('modal-template-heading');
        const saveButton = document.getElementById('modal-template-save');
        const optionInput = document.getElementById('modal-feedback-option-input');
        this.editingTemplateId = template.id;
        if (titleInput) titleInput.value = template.title || '';
        if (descInput) descInput.value = template.description || '';
        if (qInput) qInput.value = '';
        if (aInput) aInput.value = '';
        if (heading) heading.textContent = 'Редактировать шаблон';
        if (saveButton) saveButton.textContent = 'Сохранить изменения';
        this.modalReplies = Array.isArray(template.quick_replies) ? template.quick_replies.map(reply => ({ ...reply })) : [];
        this.modalFeedbackOptions = Array.isArray(template.feedback_options) ? [...template.feedback_options] : [];
        this.modalFeedbackEnabled = Boolean(template.feedback_enabled);
        this.modalFeedbackAllowFiles = this.modalFeedbackEnabled && Boolean(template.feedback_allow_files);
        if (optionInput) optionInput.value = '';
        this.renderModalFeedbackSettings();
        this.renderModalReplies();
        this.renderModalFeedbackOptions();
        if (modal) modal.style.display = 'flex';
    },

    renderModalFeedbackSettings: function() {
        const enabled = document.getElementById('modal-feedback-enabled-toggle');
        const files = document.getElementById('modal-feedback-files-toggle');
        const settings = document.getElementById('modal-feedback-settings');
        if (enabled) {
            enabled.classList.toggle('active', this.modalFeedbackEnabled);
            enabled.setAttribute('aria-checked', String(this.modalFeedbackEnabled));
        }
        if (files) {
            files.classList.toggle('active', this.modalFeedbackAllowFiles);
            files.setAttribute('aria-checked', String(this.modalFeedbackAllowFiles));
        }
        if (settings) settings.hidden = !this.modalFeedbackEnabled;
    },

    closeCreateTemplateModal: function() {
        const modal = document.getElementById('template-modal');
        if (modal) modal.style.display = 'none';
        this.editingTemplateId = null;
    },

    init: function() {
        const appContainer = document.getElementById('app-container');
        const browserGate = document.getElementById('browser-gate');

        if (!this.isMaxApp()) {
            if (appContainer) {
                appContainer.style.display = 'none';
            }
            if (browserGate) {
                browserGate.style.display = 'flex';
            }
            return;
        }

        if (browserGate) {
            browserGate.style.display = 'none';
        }
        if (appContainer) {
            appContainer.style.display = 'flex';
        }

        this.screens = {
            home: document.getElementById('home-screen'),
            templates: document.getElementById('templates-screen'),
            create: document.getElementById('create-screen'),
            recipients: document.getElementById('recipients-screen'),
            reminderView: document.getElementById('reminder-view-screen'),
            feedbackResults: document.getElementById('feedback-results-screen')
        };

        if (window.WebApp) {
            if (typeof window.WebApp.ready === 'function') {
                window.WebApp.ready();
            }

            if (window.WebApp.BackButton) {
                window.WebApp.BackButton.onClick(() => {
                    if (this.currentScreen === 'create') {
                        CreateScreen.backWizard();
                    } else if (this.currentScreen === 'recipients') {
                        const target = this.recipientsReturnScreen || 'home';
                        this.recipientsReturnScreen = null;
                        this.showScreen(target);
                        if (target === 'create') CreateScreen.loadRecipientOptions();
                    } else if (this.currentScreen === 'templates' || this.currentScreen === 'feedbackResults') {
                        this.showScreen('home');
                    }
                });
            }

            if (window.WebApp.initDataUnsafe && window.WebApp.initDataUnsafe.user) {
                const user = window.WebApp.initDataUnsafe.user;
                const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
                const currentUserName = document.getElementById('current-user-name');
                if (currentUserName && fullName) {
                    currentUserName.textContent = fullName;
                }
            }
        }

        let startParam = null;
        if (window.WebApp && window.WebApp.initDataUnsafe && window.WebApp.initDataUnsafe.start_param) {
            startParam = window.WebApp.initDataUnsafe.start_param;
        } else {
            const urlParams = new URLSearchParams(window.location.search);
            startParam = urlParams.get('start') || urlParams.get('startapp');
        }

        if (startParam && /^r_[0-9]+$/.test(startParam)) {
            this.showScreen('reminderView');
            RecipientReminder.load(Number(startParam.slice(2)));
            return;
        }

        if (startParam && startParam.startsWith('group_')) {
            const uniqueId = startParam.replace('group_', 'g_');
            this.joinGroup(uniqueId);
        }

        const showTemplatesBtn = document.getElementById('show-templates-btn');
        if (showTemplatesBtn) {
            showTemplatesBtn.addEventListener('click', () => {
                this.showScreen('templates');
            });
        }

        const backBtn = document.getElementById('back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.showScreen('home');
            });
        }

        const addReminderBtn = document.getElementById('add-reminder-btn');
        if (addReminderBtn) {
            addReminderBtn.addEventListener('click', () => CreateScreen.startWizard());
        }

        const modalCancelBtn = document.getElementById('modal-template-cancel');
        if (modalCancelBtn) {
            modalCancelBtn.addEventListener('click', () => {
                this.closeCreateTemplateModal();
            });
        }

        const bindModalFeedbackToggle = (element, property, disableFiles = false) => {
            if (!element) return;
            const toggle = () => {
                this[property] = !this[property];
                if (disableFiles && !this[property]) this.modalFeedbackAllowFiles = false;
                this.renderModalFeedbackSettings();
            };
            element.addEventListener('click', toggle);
            element.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle();
                }
            });
        };
        bindModalFeedbackToggle(document.getElementById('modal-feedback-enabled-toggle'), 'modalFeedbackEnabled', true);
        bindModalFeedbackToggle(document.getElementById('modal-feedback-files-toggle'), 'modalFeedbackAllowFiles');

        const modalFeedbackOptionAddBtn = document.getElementById('modal-feedback-option-add-btn');
        if (modalFeedbackOptionAddBtn) {
            modalFeedbackOptionAddBtn.addEventListener('click', () => {
                const input = document.getElementById('modal-feedback-option-input');
                const option = input?.value.trim();
                if (!option) return;
                if (!this.modalFeedbackOptions) this.modalFeedbackOptions = [];
                if (this.modalFeedbackOptions.length >= 20) { this.showToast('Можно добавить максимум 20 вариантов'); return; }
                if (this.modalFeedbackOptions.some(item => item.toLowerCase() === option.toLowerCase())) { this.showToast('Такой вариант уже добавлен'); return; }
                this.modalFeedbackOptions.push(option.slice(0, 200));
                input.value = '';
                this.renderModalFeedbackOptions();
            });
        }

        const modalReplyAddBtn = document.getElementById('modal-reply-add-btn');
        if (modalReplyAddBtn) {
            modalReplyAddBtn.addEventListener('click', () => {
                const q = document.getElementById('modal-reply-q')?.value.trim();
                const a = document.getElementById('modal-reply-a')?.value.trim();
                if (!q || !a) {
                    this.showToast('Заполните вопрос и ответ');
                    return;
                }
                this.modalReplies.push({ question: q, answer: a });
                document.getElementById('modal-reply-q').value = '';
                document.getElementById('modal-reply-a').value = '';
                this.renderModalReplies();
            });
        }

        const modalSaveBtn = document.getElementById('modal-template-save');
        if (modalSaveBtn) {
            modalSaveBtn.addEventListener('click', async () => {
                const titleInput = document.getElementById('modal-template-title');
                const descInput = document.getElementById('modal-template-desc');
                const title = titleInput.value.trim();
                const description = descInput.value.trim();
                if (!title) {
                    this.showToast('Введите название шаблона');
                    return;
                }
                if (!description) {
                    this.showToast('Введите текст шаблона');
                    return;
                }

                const template = {
                    title,
                    description,
                    quick_replies: this.modalReplies,
                    feedback_enabled: this.modalFeedbackEnabled,
                    feedback_allow_files: this.modalFeedbackEnabled && this.modalFeedbackAllowFiles,
                    feedback_options: this.modalFeedbackEnabled ? (this.modalFeedbackOptions || []) : []
                };
                const isEditing = this.editingTemplateId !== null;

                try {
                    if (isEditing) {
                        await this.updateTemplate(this.editingTemplateId, template);
                    } else {
                        await this.saveTemplate(template);
                    }
                } catch (error) {
                    this.showToast(error.message || (isEditing ? 'Не удалось обновить шаблон' : 'Не удалось сохранить шаблон'));
                    return;
                }

                this.closeCreateTemplateModal();
                this.showToast(isEditing ? 'Шаблон обновлён' : 'Шаблон сохранён');
                if (typeof HomeScreen !== 'undefined' && HomeScreen.loadData) {
                    HomeScreen.loadData();
                }
                if (typeof TemplatesScreen !== 'undefined' && TemplatesScreen.loadTemplates) {
                    TemplatesScreen.loadTemplates();
                }
            });
        }

        this.showScreen('home');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
