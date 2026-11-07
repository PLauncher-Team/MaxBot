const RecipientReminder = {
    reminderId: null,
    mediaObjectUrls: [],
    feedbackFiles: [],
    questionModal: null,

    revokeMediaObjectUrls: function() {
        this.mediaObjectUrls.forEach(url => URL.revokeObjectURL(url));
        this.mediaObjectUrls = [];
    },

    fetchMediaObjectUrl: async function(url) {
        const response = await fetch(url, { headers: App.getAuthHeaders() });
        if (!response.ok) throw new Error('Не удалось загрузить вложение');
        const objectUrl = URL.createObjectURL(await response.blob());
        this.mediaObjectUrls.push(objectUrl);
        return objectUrl;
    },

    setState: function(message, isError = false) {
        this.revokeMediaObjectUrls();
        const state = document.getElementById('reminder-view-state');
        const card = document.getElementById('reminder-view-card');
        const replies = document.getElementById('reminder-view-replies');
        if (state) {
            state.textContent = message;
            state.classList.toggle('is-error', isError);
            state.style.display = 'block';
        }
        if (card) card.style.display = 'none';
        if (replies) replies.style.display = 'none';
    },

    load: async function(reminderId) {
        this.reminderId = reminderId;
        this.setState('Загружаем напоминание…');

        try {
            const response = await fetch('/api/reminders/public/' + encodeURIComponent(reminderId), {
                headers: App.getAuthHeaders()
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || 'Не удалось загрузить напоминание');
            }
            if (data.feedback_submission) {
                const maxUser = window.WebApp?.initDataUnsafe?.user || {};
                const recipientName = [maxUser.first_name, maxUser.last_name]
                    .filter(value => typeof value === 'string' && value.trim())
                    .join(' ')
                    .trim() || (typeof maxUser.name === 'string' ? maxUser.name.trim() : '');
                if (recipientName) {
                    fetch('/api/reminders/public/' + encodeURIComponent(reminderId) + '/feedback/profile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...App.getAuthHeaders() },
                        body: JSON.stringify({ recipient_name: recipientName })
                    }).catch(() => {});
                }
            }
            await this.render(data);
        } catch (error) {
            this.setState(error.message || 'Не удалось загрузить напоминание', true);
        }
    },

    render: async function(reminder) {
        const state = document.getElementById('reminder-view-state');
        const card = document.getElementById('reminder-view-card');
        const mediaContainer = document.getElementById('reminder-view-media');
        const filesContainer = document.getElementById('reminder-view-files');
        const title = document.getElementById('reminder-view-title');
        const description = document.getElementById('reminder-view-description');
        const sender = document.getElementById('reminder-view-sender');
        const repliesSection = document.getElementById('reminder-view-replies');
        const feedbackForm = document.getElementById('recipient-feedback-form');
        if (feedbackForm) feedbackForm.style.display = 'none';
        const repliesList = document.getElementById('reminder-view-replies-list');

        title.textContent = reminder.title || '';
        if (sender) {
            sender.replaceChildren();
            const senderId = String(reminder.sender?.id || '').replace(/[^0-9]/g, '');
            const senderName = String(reminder.sender?.name || '').trim();
            if (senderId) {
                const label = document.createElement('span');
                label.textContent = 'От кого: ';
                const link = document.createElement('a');
                link.href = 'max://user/' + senderId;
                link.textContent = senderName || 'Учитель';
                sender.append(label, link);
                sender.hidden = false;
            } else {
                sender.hidden = true;
            }
        }
        description.textContent = reminder.description || '';
        description.style.display = reminder.description ? 'block' : 'none';
        mediaContainer.replaceChildren();
        if (filesContainer) filesContainer.replaceChildren();

        const rawMedia = Array.isArray(reminder.images) ? reminder.images : [];
        const media = (await Promise.all(rawMedia
            .filter(item => item && typeof item.url === 'string' && item.type === 'image')
            .slice(0, 3)
            .map(async item => {
                try {
                    return { ...item, objectUrl: await this.fetchMediaObjectUrl(item.url) };
                } catch (error) {
                    return null;
                }
            }))).filter(Boolean);
        const files = rawMedia
            .filter(item => item && typeof item.download_url === 'string' && item.type === 'file')
            .slice(0, 3);
        if (media.length === 1) {
            const image = document.createElement('img');
            image.className = 'recipient-reminder-media-item';
            image.src = media[0].objectUrl;
            image.alt = media[0].name || reminder.title || 'Изображение';
            image.loading = 'lazy';
            mediaContainer.appendChild(image);
        } else if (media.length > 1) {
            let activeIndex = 0;
            const gallery = document.createElement('div');
            gallery.className = 'recipient-reminder-gallery';
            const viewport = document.createElement('div');
            viewport.className = 'recipient-reminder-gallery-viewport';
            const image = document.createElement('img');
            image.className = 'recipient-reminder-media-item recipient-reminder-gallery-image';
            image.alt = reminder.title || 'Изображение';
            image.loading = 'lazy';
            const controls = document.createElement('div');
            controls.className = 'recipient-reminder-gallery-controls';
            const previous = document.createElement('button');
            previous.type = 'button';
            previous.className = 'recipient-reminder-gallery-arrow';
            previous.textContent = '‹';
            previous.setAttribute('aria-label', 'Предыдущее фото');
            const counter = document.createElement('span');
            counter.className = 'recipient-reminder-gallery-counter';
            const next = document.createElement('button');
            next.type = 'button';
            next.className = 'recipient-reminder-gallery-arrow';
            next.textContent = '›';
            next.setAttribute('aria-label', 'Следующее фото');
            const showImage = () => {
                image.src = media[activeIndex].objectUrl;
                counter.textContent = (activeIndex + 1) + '/' + media.length;
                previous.disabled = activeIndex === 0;
                next.disabled = activeIndex === media.length - 1;
            };
            previous.addEventListener('click', () => {
                if (activeIndex > 0) {
                    activeIndex -= 1;
                    showImage();
                }
            });
            next.addEventListener('click', () => {
                if (activeIndex < media.length - 1) {
                    activeIndex += 1;
                    showImage();
                }
            });
            viewport.appendChild(image);
            controls.append(previous, counter, next);
            gallery.append(viewport, controls);
            mediaContainer.appendChild(gallery);
            showImage();
        }
        mediaContainer.style.display = media.length > 0 ? 'block' : 'none';

        if (filesContainer) {
            filesContainer.classList.add('recipient-reminder-documents');
            files.forEach(item => {
                const link = document.createElement('a');
                link.className = 'recipient-reminder-document';
                link.href = item.download_url;
                link.download = item.name || 'Файл';
                link.rel = 'noopener';
                link.addEventListener('click', event => {
                    const platform = String(window.WebApp?.platform || '').toLowerCase();
                    if (!['ios', 'android', 'desktop'].includes(platform)) return;
                    event.preventDefault();
                    if (typeof window.WebApp?.downloadFile !== 'function') {
                        App.showToast('Не удалось запустить скачивание. Обновите приложение MAX');
                        return;
                    }
                    try {
                        const download = window.WebApp.downloadFile(item.download_url, item.name || 'Файл');
                        Promise.resolve(download).catch(error => {
                            const code = error?.error?.code || error?.code || 'unknown';
                            console.error('MAX file download failed:', code, error);
                            App.showToast('MAX не смог скачать файл: ' + code);
                        });
                    } catch (error) {
                        const code = error?.error?.code || error?.code || 'unknown';
                        console.error('MAX file download failed:', code, error);
                        App.showToast('MAX не смог скачать файл: ' + code);
                    }
                });
                const icon = document.createElement('span');
                const extension = App.getFileExtension(item.name);
                icon.className = 'recipient-reminder-document-icon recipient-reminder-document-icon-' + App.getFileIconType(item.name);
                icon.dataset.extension = extension.toUpperCase() || 'FILE';
                icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.75h8l4.5 4.5v14H6z"></path><path d="M14 2.75v5h4.5M9 13h6M9 16h6"></path></svg>';
                const name = document.createElement('span');
                name.className = 'recipient-reminder-document-name';
                name.textContent = item.name || 'Файл';
                link.append(icon, name);
                filesContainer.appendChild(link);
            });
            filesContainer.style.display = files.length ? 'grid' : 'none';
        }

        if (this.questionModal) this.closeQuestionModal();
        repliesList.replaceChildren();
        const quickReplies = Array.isArray(reminder.quick_replies) ? reminder.quick_replies : [];
        quickReplies.forEach(reply => {
            if (!reply || typeof reply.question !== 'string') return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'recipient-reminder-reply-button';
            button.textContent = reply.question;
            const answer = document.createElement('div');
            answer.className = 'recipient-reminder-reply-answer';
            const answerLabel = document.createElement('div');
            answerLabel.className = 'recipient-reminder-reply-answer-label';
            answerLabel.textContent = 'Ответ';
            const answerText = document.createElement('div');
            answerText.className = 'recipient-reminder-reply-answer-text';
            answerText.textContent = reply.answer || '';
            answer.append(answerLabel, answerText);
            answer.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.addEventListener('click', () => {
                const expanded = answer.hidden;
                answer.hidden = !expanded;
                button.setAttribute('aria-expanded', String(expanded));
                button.classList.toggle('is-expanded', expanded);
            });
            const item = document.createElement('div');
            item.className = 'recipient-reminder-reply-item';
            item.append(button, answer);
            repliesList.appendChild(item);
        });

        const recipientQuestions = Array.isArray(reminder.questions) ? reminder.questions : [];
        recipientQuestions.forEach(question => {
            if (!question || typeof question.question !== 'string') return;
            const answered = typeof question.answer === 'string' && question.answer.trim().length > 0;
            const item = document.createElement('div');
            item.className = 'recipient-reminder-reply-item recipient-reminder-question-item' + (answered ? '' : ' is-unanswered');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'recipient-reminder-reply-button recipient-reminder-question-button';
            button.textContent = question.question;
            const answer = document.createElement('div');
            answer.className = 'recipient-reminder-reply-answer';
            const answerLabel = document.createElement('div');
            answerLabel.className = 'recipient-reminder-reply-answer-label';
            answerLabel.textContent = answered ? 'Ответ' : 'Ответ пока не получен';
            const answerText = document.createElement('div');
            answerText.className = 'recipient-reminder-reply-answer-text';
            answerText.textContent = answered ? question.answer : 'Автор напоминания ещё не ответил на этот вопрос.';
            answer.append(answerLabel, answerText);
            answer.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.addEventListener('click', () => {
                const expanded = answer.hidden;
                answer.hidden = !expanded;
                button.setAttribute('aria-expanded', String(expanded));
                button.classList.toggle('is-expanded', expanded);
            });
            item.append(button, answer);
            repliesList.appendChild(item);
        });

        repliesSection.querySelectorAll('.recipient-question-trigger').forEach(button => button.remove());
        const askQuestionButton = document.createElement('button');
        askQuestionButton.type = 'button';
        askQuestionButton.className = 'recipient-question-trigger';
        askQuestionButton.textContent = 'Задать вопрос';
        askQuestionButton.addEventListener('click', () => this.openQuestionModal());
        repliesSection.appendChild(askQuestionButton);
        repliesSection.style.display = 'block';
        if (feedbackForm) this.renderFeedbackForm(feedbackForm, reminder);
        state.style.display = 'none';
        card.style.display = 'block';
    },

    openQuestionModal: function() {
        if (this.questionModal) return;
        const overlay = document.createElement('div');
        overlay.className = 'recipient-question-modal';
        const panel = document.createElement('section');
        panel.className = 'recipient-question-modal-card';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'recipient-question-modal-title');

        const header = document.createElement('div');
        header.className = 'recipient-question-modal-header';
        const title = document.createElement('h2');
        title.id = 'recipient-question-modal-title';
        title.textContent = 'Задать вопрос';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'recipient-question-modal-close';
        close.setAttribute('aria-label', 'Закрыть');
        close.textContent = '×';
        close.addEventListener('click', () => this.closeQuestionModal());
        header.append(title, close);

        const textarea = document.createElement('textarea');
        textarea.className = 'recipient-question-modal-input';
        textarea.maxLength = 500;
        textarea.rows = 4;
        textarea.placeholder = 'Напишите ваш вопрос';

        const note = document.createElement('p');
        note.className = 'recipient-question-modal-note';
        note.textContent = 'Ваш вопрос будет виден всем получателям этого напоминания.';

        const actions = document.createElement('div');
        actions.className = 'recipient-question-modal-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'recipient-question-modal-cancel';
        cancel.textContent = 'Отмена';
        cancel.addEventListener('click', () => this.closeQuestionModal());
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'recipient-question-modal-submit';
        submit.textContent = 'Отправить';
        submit.addEventListener('click', async () => {
            const question = textarea.value.trim();
            if (!question) {
                App.showToast('Введите вопрос');
                textarea.focus();
                return;
            }
            submit.disabled = true;
            submit.textContent = 'Отправка…';
            const maxUser = window.WebApp?.initDataUnsafe?.user || {};
            const recipientName = [maxUser.first_name, maxUser.last_name]
                .filter(value => typeof value === 'string' && value.trim())
                .join(' ')
                .trim() || (typeof maxUser.name === 'string' ? maxUser.name.trim() : '');
            try {
                const response = await fetch('/api/reminders/public/' + encodeURIComponent(this.reminderId) + '/questions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...App.getAuthHeaders() },
                    body: JSON.stringify({ question, recipient_name: recipientName })
                });
                const result = await response.json().catch(() => null);
                if (!response.ok) throw new Error(result?.error || 'Не удалось отправить вопрос');
                this.closeQuestionModal();
                App.showToast('Вопрос опубликован');
                await this.load(this.reminderId);
            } catch (error) {
                App.showToast(error.message || 'Не удалось отправить вопрос');
                submit.disabled = false;
                submit.textContent = 'Отправить';
            }
        });
        actions.append(cancel, submit);
        panel.append(header, textarea, note, actions);
        overlay.appendChild(panel);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) this.closeQuestionModal();
        });
        document.body.appendChild(overlay);
        this.questionModal = overlay;
        textarea.focus();
    },

    closeQuestionModal: function() {
        if (this.questionModal) this.questionModal.remove();
        this.questionModal = null;
    },

    formatFeedbackFileSize: function(bytes) {
        const size = Number(bytes) || 0;
        if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1).replace('.', ',') + ' МБ';
        return Math.max(1, Math.round(size / 1024)) + ' КБ';
    },

    renderFeedbackFiles: function(list) {
        list.replaceChildren();
        if (!this.feedbackFiles.length) {
            const empty = document.createElement('div');
            empty.className = 'recipient-feedback-files-empty';
            empty.textContent = 'Файлы пока не добавлены';
            list.appendChild(empty);
        }
        this.feedbackFiles.forEach(item => {
            const row = document.createElement('div');
            row.className = 'recipient-feedback-file-chip';
            const visual = document.createElement('div');
            visual.className = 'recipient-feedback-file-visual';
            if (item.pending) {
                visual.classList.add('is-uploading');
                const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                ring.setAttribute('viewBox', '0 0 48 48');
                ring.setAttribute('aria-hidden', 'true');
                const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                track.setAttribute('class', 'recipient-feedback-progress-track');
                track.setAttribute('cx', '24');
                track.setAttribute('cy', '24');
                track.setAttribute('r', '20');
                const value = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                value.setAttribute('class', 'recipient-feedback-progress-value');
                value.setAttribute('cx', '24');
                value.setAttribute('cy', '24');
                value.setAttribute('r', '20');
                const progress = Math.max(0, Math.min(100, Number(item.progress) || 0));
                value.style.strokeDashoffset = String(125.66 * (1 - progress / 100));
                ring.append(track, value);
                const percent = document.createElement('span');
                percent.className = 'recipient-feedback-progress-percent';
                percent.textContent = progress + '%';
                visual.append(ring, percent);
            } else {
                const ext = String(item.name || '').split('.').pop().slice(0, 5).toUpperCase() || 'FILE';
                visual.classList.add('recipient-feedback-file-type');
                visual.textContent = ext;
            }

            const copy = document.createElement('div');
            copy.className = 'recipient-feedback-file-copy';
            const name = document.createElement('span');
            name.className = 'recipient-feedback-file-name';
            name.textContent = item.name || 'Файл';
            const meta = document.createElement('span');
            meta.className = 'recipient-feedback-file-meta';
            meta.textContent = item.pending
                ? 'Загружается · ' + this.formatFeedbackFileSize(item.size)
                : (item.isSaved ? 'Отправлен · ' : 'Готов к отправке · ') + this.formatFeedbackFileSize(item.size);
            copy.append(name, meta);
            row.append(visual, copy);

            const actions = document.createElement('div');
            actions.className = 'recipient-feedback-file-actions';
            if (item.isSaved && item.download_url) {
                const download = document.createElement('button');
                download.type = 'button';
                download.className = 'recipient-feedback-file-action';
                download.setAttribute('aria-label', 'Скачать ' + (item.name || 'файл'));
                download.title = 'Скачать';
                download.textContent = '↓';
                download.addEventListener('click', () => this.downloadFeedbackFile(item));
                actions.appendChild(download);
            }
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'recipient-feedback-file-action is-remove';
            remove.setAttribute('aria-label', 'Удалить ' + (item.name || 'файл'));
            remove.title = 'Удалить';
            remove.textContent = '×';
            remove.disabled = Boolean(item.removing);
            remove.addEventListener('click', () => this.removeFeedbackFile(item, list));
            actions.appendChild(remove);
            row.appendChild(actions);
            list.appendChild(row);
        });

        if (this.feedbackFileChooseButton) {
            this.feedbackFileChooseButton.disabled = this.feedbackFiles.length >= 3;
        }
    },

    uploadFeedbackFile: async function(file, item, list) {
        try {
            const uploaded = await App.uploadAttachment(file, progress => {
                item.progress = progress;
                this.renderFeedbackFiles(list);
            }, 'file');
            if (!this.feedbackFiles.includes(item)) {
                if (uploaded.filename) await this.deleteFeedbackUpload(uploaded.filename).catch(() => {});
                return;
            }
            Object.assign(item, uploaded, {
                pending: false,
                isNew: true,
                isSaved: false,
                type: 'file'
            });
        } catch (error) {
            const index = this.feedbackFiles.indexOf(item);
            if (index !== -1) this.feedbackFiles.splice(index, 1);
            App.showToast(error.message || 'Не удалось загрузить файл');
        }
        this.renderFeedbackFiles(list);
    },

    downloadFeedbackFile: async function(item) {
        try {
            const response = await fetch(item.download_url, { headers: App.getAuthHeaders() });
            if (!response.ok) throw new Error('Не удалось скачать файл');
            const objectUrl = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = item.name || 'Файл';
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch (error) {
            App.showToast(error.message || 'Не удалось скачать файл');
        }
    },

    deleteFeedbackUpload: async function(filename) {
        const response = await fetch('/api/reminders/public/' + encodeURIComponent(this.reminderId) + '/feedback/files/' + encodeURIComponent(filename), {
            method: 'DELETE',
            headers: App.getAuthHeaders()
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'Не удалось удалить файл');
        return result;
    },

    removeFeedbackFile: async function(item, list) {
        if (item.removing) return;
        const index = this.feedbackFiles.indexOf(item);
        if (index === -1) return;
        if (item.pending) {
            this.feedbackFiles.splice(index, 1);
            this.renderFeedbackFiles(list);
            return;
        }
        item.removing = true;
        this.renderFeedbackFiles(list);
        try {
            if (item.filename) await this.deleteFeedbackUpload(item.filename);
            const currentIndex = this.feedbackFiles.indexOf(item);
            if (currentIndex !== -1) this.feedbackFiles.splice(currentIndex, 1);
            App.showToast('Файл удалён');
        } catch (error) {
            item.removing = false;
            App.showToast(error.message || 'Не удалось удалить файл');
        }
        this.renderFeedbackFiles(list);
    },

    renderFeedbackForm: function(container, reminder) {
        container.replaceChildren();
        this.feedbackFiles = [];
        this.feedbackFileChooseButton = null;
        if (!reminder.feedback_enabled) {
            container.style.display = 'none';
            return;
        }

        const options = (Array.isArray(reminder.feedback_options) ? reminder.feedback_options : [])
            .filter(option => typeof option === 'string' && option.trim());
        if (!options.length && !reminder.feedback_allow_files) {
            container.style.display = 'none';
            return;
        }

        const previous = reminder.feedback_submission && typeof reminder.feedback_submission === 'object'
            ? reminder.feedback_submission
            : null;
        this.hasPreviousFeedback = Boolean(previous);
        this.feedbackFiles = (Array.isArray(previous?.files) ? previous.files : []).map(file => ({
            ...file,
            type: 'file',
            isSaved: true,
            isNew: false,
            pending: false
        }));

        const heading = document.createElement('div');
        heading.className = 'recipient-reminder-replies-heading';
        heading.textContent = this.hasPreviousFeedback ? 'Ваш ответ' : (options.length ? 'Обратная связь' : 'Ваши файлы');
        container.appendChild(heading);

        const description = document.createElement('p');
        description.className = 'recipient-feedback-description';
        description.textContent = options.length
            ? 'Выберите подходящий вариант. Ответ можно изменить позже.'
            : 'Прикрепите файлы, которые хотите отправить учителю.';
        container.appendChild(description);

        let selectedOption = typeof previous?.answers?.choice === 'string' ? previous.answers.choice : '';
        if (options.length) {
            const wrap = document.createElement('div');
            wrap.className = 'recipient-feedback-question recipient-feedback-options';
            options.forEach(option => {
                const label = document.createElement('label');
                label.className = 'recipient-feedback-option';
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = 'recipient-feedback-choice-' + this.reminderId;
                input.value = option;
                input.checked = selectedOption === option;
                label.classList.toggle('is-selected', input.checked);
                input.addEventListener('change', () => {
                    selectedOption = option;
                    wrap.querySelectorAll('.recipient-feedback-option').forEach(optionLabel => {
                        optionLabel.classList.toggle('is-selected', optionLabel.querySelector('input')?.checked === true);
                    });
                });
                const text = document.createElement('span');
                text.textContent = option;
                label.append(input, text);
                wrap.appendChild(label);
            });
            container.appendChild(wrap);
        }

        let fileList = null;
        if (reminder.feedback_allow_files) {
            const fileWrap = document.createElement('div');
            fileWrap.className = 'recipient-feedback-files';
            const label = document.createElement('div');
            label.className = 'recipient-feedback-files-title';
            label.textContent = 'Файлы';
            const note = document.createElement('div');
            note.className = 'recipient-feedback-files-note';
            note.textContent = 'До 3 файлов · не более 10 МБ каждый';
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.className = 'recipient-feedback-file-input';
            const chooseButton = document.createElement('button');
            chooseButton.type = 'button';
            chooseButton.className = 'recipient-feedback-file-upload';
            chooseButton.textContent = '＋ Добавить файлы';
            chooseButton.addEventListener('click', () => input.click());
            input.addEventListener('change', () => {
                const selectedFiles = Array.from(input.files || []);
                const availableSlots = Math.max(0, 3 - this.feedbackFiles.length);
                if (selectedFiles.length > availableSlots) {
                    App.showToast('Можно прикрепить не более 3 файлов');
                }
                selectedFiles.slice(0, availableSlots).forEach(file => {
                    if (file.size > 10 * 1024 * 1024) {
                        App.showToast('Каждый файл должен быть не больше 10 МБ');
                        return;
                    }
                    const pending = {
                        pending: true,
                        progress: 0,
                        type: 'file',
                        name: file.name || 'Файл',
                        size: file.size || 0
                    };
                    this.feedbackFiles.push(pending);
                    this.renderFeedbackFiles(fileList);
                    this.uploadFeedbackFile(file, pending, fileList);
                });
                input.value = '';
            });
            fileList = document.createElement('div');
            fileList.className = 'recipient-feedback-file-list';
            this.feedbackFileChooseButton = chooseButton;
            fileWrap.append(label, note, chooseButton, input, fileList);
            container.appendChild(fileWrap);
            this.renderFeedbackFiles(fileList);
        }

        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'quick-reply-submit-btn recipient-feedback-submit';
        submit.textContent = this.hasPreviousFeedback ? 'Сохранить изменения' : (options.length ? 'Отправить ответ' : 'Отправить файлы');
        submit.addEventListener('click', async () => {
            if (this.feedbackFiles.some(file => file.pending)) {
                App.showToast('Дождитесь окончания загрузки файлов');
                return;
            }
            if (options.length && !selectedOption && !this.feedbackFiles.length) {
                App.showToast('Выберите вариант ответа');
                return;
            }
            submit.disabled = true;
            submit.textContent = 'Отправка…';
            try {
                const answers = selectedOption ? { choice: selectedOption } : {};
                const uploadedFiles = this.feedbackFiles
                    .filter(file => file.filename)
                    .map(file => ({ filename: file.filename, name: file.name }));
                const maxUser = window.WebApp?.initDataUnsafe?.user || {};
                const recipientName = [maxUser.first_name, maxUser.last_name]
                    .filter(value => typeof value === 'string' && value.trim())
                    .join(' ')
                    .trim() || (typeof maxUser.name === 'string' ? maxUser.name.trim() : '');
                const response = await fetch('/api/reminders/public/' + encodeURIComponent(this.reminderId) + '/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...App.getAuthHeaders() },
                    body: JSON.stringify({ answers, files: uploadedFiles, recipient_name: recipientName })
                });
                const result = await response.json().catch(() => null);
                if (!response.ok) throw new Error(result?.error || 'Не удалось отправить ответ');
                this.hasPreviousFeedback = true;
                this.feedbackFiles.forEach(file => {
                    file.pending = false;
                    file.isNew = false;
                    file.isSaved = true;
                    file.download_url = '/api/reminders/public/' + encodeURIComponent(this.reminderId) + '/feedback/files/' + encodeURIComponent(file.filename);
                });
                if (fileList) this.renderFeedbackFiles(fileList);
                App.showToast('Ответ сохранён');
                submit.textContent = 'Изменения сохранены';
                submit.disabled = false;
            } catch (error) {
                App.showToast(error.message || 'Не удалось отправить ответ');
                submit.disabled = false;
                submit.textContent = this.hasPreviousFeedback ? 'Сохранить изменения' : (options.length ? 'Отправить ответ' : 'Отправить файлы');
            }
        });
        container.appendChild(submit);
        container.style.display = 'block';
    }

};
