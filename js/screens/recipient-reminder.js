const RecipientReminder = {
    reminderId: null,
    mediaObjectUrls: [],
    feedbackFiles: [],

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
                icon.className = 'recipient-reminder-document-icon';
                icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.75h8l4.5 4.5v14H6z"></path><path d="M14 2.75v5h4.5M9 13h6M9 16h6"></path></svg>';
                const name = document.createElement('span');
                name.className = 'recipient-reminder-document-name';
                name.textContent = item.name || 'Файл';
                link.append(icon, name);
                filesContainer.appendChild(link);
            });
            filesContainer.style.display = files.length ? 'grid' : 'none';
        }

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

        repliesSection.style.display = repliesList.childElementCount > 0 ? 'block' : 'none';
        if (feedbackForm) this.renderFeedbackForm(feedbackForm, reminder);
        state.style.display = 'none';
        card.style.display = 'block';
    },

    renderFeedbackForm: function(container, reminder) {
        container.replaceChildren();
        this.feedbackFiles = [];
        if (!reminder.feedback_enabled) { container.style.display = 'none'; return; }
        const heading = document.createElement('div');
        heading.className = 'recipient-reminder-replies-heading';
        heading.textContent = 'Обратная связь';
        container.appendChild(heading);
        const fields = [];
        (Array.isArray(reminder.quick_replies) ? reminder.quick_replies : []).forEach((question, index) => {
            const wrap = document.createElement('div');
            wrap.className = 'recipient-feedback-question';
            const label = document.createElement('label');
            label.textContent = question.question || ('Вопрос ' + (index + 1));
            const textarea = document.createElement('textarea');
            textarea.maxLength = 1000;
            textarea.placeholder = 'Ваш ответ';
            wrap.append(label, textarea);
            container.appendChild(wrap);
            fields.push({ index, textarea });
        });
        if (reminder.feedback_allow_files) {
            const fileWrap = document.createElement('div');
            fileWrap.className = 'recipient-feedback-files';
            const label = document.createElement('label');
            label.textContent = 'Файлы (до 3, не более 10 МБ каждый)';
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.md,.odt,.ods,.odp,.zip';
            const names = document.createElement('div');
            input.addEventListener('change', () => {
                const files = Array.from(input.files || []);
                if (files.length > 3) { App.showToast('Можно прикрепить не более 3 файлов'); input.value = ''; return; }
                if (files.some(file => file.size > 10 * 1024 * 1024)) { App.showToast('Каждый файл должен быть не больше 10 МБ'); input.value = ''; return; }
                this.feedbackFiles = files;
                names.textContent = files.map(file => file.name).join(', ');
            });
            fileWrap.append(label, input, names);
            container.appendChild(fileWrap);
        }
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'quick-reply-submit-btn recipient-feedback-submit';
        submit.textContent = 'Отправить ответы';
        submit.addEventListener('click', async () => {
            submit.disabled = true;
            submit.textContent = 'Отправка…';
            try {
                const answers = {};
                fields.forEach(field => { if (field.textarea.value.trim()) answers[field.index] = field.textarea.value.trim(); });
                const files = [];
                for (const file of this.feedbackFiles) {
                    const data = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result || ''));
                        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
                        reader.readAsDataURL(file);
                    });
                    const response = await fetch('/api/reminders/upload-file', { method: 'POST', headers: { 'Content-Type': 'application/json', ...App.getAuthHeaders() }, body: JSON.stringify({ media_data: data, file_name: file.name }) });
                    const uploaded = await response.json().catch(() => null);
                    if (!response.ok) throw new Error(uploaded?.error || 'Не удалось загрузить файл');
                    files.push({ filename: uploaded.filename, name: uploaded.name });
                }
                const response = await fetch('/api/reminders/public/' + encodeURIComponent(this.reminderId) + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', ...App.getAuthHeaders() }, body: JSON.stringify({ answers, files }) });
                const result = await response.json().catch(() => null);
                if (!response.ok) throw new Error(result?.error || 'Не удалось отправить ответы');
                App.showToast('Обратная связь отправлена');
                submit.textContent = 'Ответы отправлены';
                fields.forEach(field => field.textarea.disabled = true);
                container.querySelectorAll('input').forEach(input => input.disabled = true);
            } catch (error) {
                App.showToast(error.message || 'Не удалось отправить обратную связь');
                submit.disabled = false;
                submit.textContent = 'Отправить ответы';
            }
        });
        container.appendChild(submit);
        container.style.display = 'block';
    },

};
