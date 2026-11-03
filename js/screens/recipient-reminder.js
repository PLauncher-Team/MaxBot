const RecipientReminder = {
    reminderId: null,

    setState: function(message, isError = false) {
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
            this.render(data);
        } catch (error) {
            this.setState(error.message || 'Не удалось загрузить напоминание', true);
        }
    },

    render: function(reminder) {
        const state = document.getElementById('reminder-view-state');
        const card = document.getElementById('reminder-view-card');
        const mediaContainer = document.getElementById('reminder-view-media');
        const title = document.getElementById('reminder-view-title');
        const description = document.getElementById('reminder-view-description');
        const sender = document.getElementById('reminder-view-sender');
        const repliesSection = document.getElementById('reminder-view-replies');
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

        const media = (Array.isArray(reminder.images) ? reminder.images : [])
            .filter(item => item && typeof item.url === 'string')
            .slice(0, 3);

        if (media.length === 1) {
            const image = document.createElement('img');
            image.className = 'recipient-reminder-media-item';
            image.src = media[0].url;
            image.alt = reminder.title || 'Изображение';
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
                image.src = media[activeIndex].url;
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
        state.style.display = 'none';
        card.style.display = 'block';
    },

};
