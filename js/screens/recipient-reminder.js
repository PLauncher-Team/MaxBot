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
        const repliesSection = document.getElementById('reminder-view-replies');
        const repliesList = document.getElementById('reminder-view-replies-list');

        title.textContent = reminder.title || '';
        description.textContent = reminder.description || '';
        description.style.display = reminder.description ? 'block' : 'none';
        mediaContainer.replaceChildren();

        const media = Array.isArray(reminder.images) ? reminder.images : [];
        media.forEach(item => {
            if (!item || typeof item.url !== 'string') return;
            const element = document.createElement('img');
            element.className = 'recipient-reminder-media-item';
            element.src = item.url;
            element.alt = reminder.title || 'Изображение';
            element.loading = 'lazy';
            mediaContainer.appendChild(element);
        });
        mediaContainer.style.display = mediaContainer.childElementCount > 0 ? 'grid' : 'none';

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
            answer.textContent = reply.answer || '';
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
