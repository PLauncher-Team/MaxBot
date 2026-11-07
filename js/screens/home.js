const HomeScreen = {
    selectedParticipantIds: [],
    selectedGroupIds: [],
    expandedGroupIds: {},
    recipientGroups: [],
    recipientParticipants: [],
    remindersRefreshInProgress: false,
    recipientRefreshInProgress: false,
    recipientDataRequestId: 0,
    pendingSentDeleteId: null,
    sentDeleteInProgress: false,
    pendingRecipientQuestionDeleteId: null,
    recipientQuestionDeleteInProgress: false,
    feedbackReminderId: null,
    expandedReminderSections: { scheduled: false, sent: false },

    updateTemplateScrollControls: function() {
        const container = document.getElementById('templates-scroll');
        const leftButton = document.getElementById('scroll-left-btn');
        const rightButton = document.getElementById('scroll-right-btn');
        if (!container || !leftButton || !rightButton) return;

        const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
        const hasOverflow = maxScroll > 2;
        const currentScroll = container.scrollLeft;

        leftButton.hidden = !hasOverflow;
        rightButton.hidden = !hasOverflow;
        leftButton.disabled = !hasOverflow || currentScroll <= 2;
        rightButton.disabled = !hasOverflow || currentScroll >= maxScroll - 2;
        leftButton.setAttribute('aria-hidden', String(!hasOverflow));
        rightButton.setAttribute('aria-hidden', String(!hasOverflow));
    },

    loadData: async function() {
        const templatesScroll = document.getElementById('templates-scroll');
        const homeTemplatesCount = document.getElementById('home-templates-count');
        const addCard = document.getElementById('home-add-template-card');

        try {
            const templates = await App.getTemplates();
            if (homeTemplatesCount) {
                homeTemplatesCount.textContent = templates.length;
            }

            if (templatesScroll) {
                templatesScroll.querySelectorAll('.template-card').forEach(el => el.remove());
                templates.forEach(t => {
                    const card = document.createElement('div');
                    card.className = 'template-card';
                    card.setAttribute('data-id', t.id);
                    const displayTitle = String(t.title || '');
                    card.innerHTML = `
                        <button type="button" class="template-card-open">
                            <div class="template-title">${App.escapeHtml(displayTitle)}</div>
                            <div class="template-badge">Шаблон</div>
                        </button>
                        <button type="button" class="template-edit-btn" aria-label="Редактировать шаблон ${App.escapeHtml(displayTitle)}" title="Редактировать">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg>
                        </button>
                    `;
                    card.querySelector('.template-card-open').addEventListener('click', () => {
                        CreateScreen.startWizard(t);
                    });
                    card.querySelector('.template-edit-btn').addEventListener('click', () => {
                        App.openEditTemplateModal(t);
                    });
                    templatesScroll.insertBefore(card, addCard);
                });
            }

        } catch (error) {
            console.error('Failed to load templates:', error);
            App.showToast(error.message || 'Не удалось загрузить шаблоны');
        }

        this.updateTemplateScrollControls();

        try {
            await this.loadRecipientsData();
        } catch (error) {
            console.error('Failed to load recipient names:', error);
        }
        await this.refreshReminders();
    },

    formatSentRecipients: function(recipients) {
        if (!Array.isArray(recipients)) return '';

        return recipients.map(value => {
            if (value === 'Себе') return 'Себе';

            const personMatch = /^person:([0-9]+)$/.exec(String(value));
            if (personMatch) {
                const participant = this.recipientParticipants.find(item =>
                    String(item.id) === personMatch[1]
                );
                return participant && participant.name
                    ? participant.name
                    : 'Отдельный участник';
            }

            return String(value);
        }).join(', ');
    },

    formatSentTime: function(item) {
        const value = typeof item.sent_at === 'string' && item.sent_at
            ? item.sent_at
            : item.created_at;
        if (!value) return 'Дата не сохранена';

        const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
        if (!match) return 'Дата не сохранена';

        const [, year, month, day, hours, minutes] = match;
        const date = new Date(Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hours) + (item.sent_at ? 0 : 3),
            Number(minutes)
        ));
        const pad = number => String(number).padStart(2, '0');

        return pad(date.getUTCDate()) + '.' +
            pad(date.getUTCMonth() + 1) + '.' +
            date.getUTCFullYear() + ' ' +
            pad(date.getUTCHours()) + ':' +
            pad(date.getUTCMinutes()) + ' МСК';
    },

    openSentDeleteModal: function(item) {
        const modal = document.getElementById('sent-delete-modal');
        if (!modal || this.sentDeleteInProgress) return;
        this.pendingSentDeleteId = item.id;
        modal.style.display = 'flex';
    },

    closeSentDeleteModal: function() {
        if (this.sentDeleteInProgress) return;
        const modal = document.getElementById('sent-delete-modal');
        if (modal) modal.style.display = 'none';
        this.pendingSentDeleteId = null;
    },

    confirmSentDelete: async function() {
        if (this.pendingSentDeleteId === null || this.sentDeleteInProgress) return;

        const modal = document.getElementById('sent-delete-modal');
        const confirmButton = document.getElementById('sent-delete-confirm');
        const cancelButton = document.getElementById('sent-delete-cancel');
        const buttonText = confirmButton ? confirmButton.textContent : '';

        this.sentDeleteInProgress = true;
        if (confirmButton) {
            confirmButton.disabled = true;
            confirmButton.textContent = 'Удаление...';
        }
        if (cancelButton) cancelButton.disabled = true;

        try {
            const result = await App.deleteReminder(this.pendingSentDeleteId);
            if (result && result.error) {
                App.showToast(result.error);
            } else {
                App.showToast('Отправленное сообщение удалено');
            }
            if (modal) modal.style.display = 'none';
            this.pendingSentDeleteId = null;
            if (!result || !result.error) await this.refreshReminders();
        } catch (error) {
            App.showToast('Не удалось удалить сообщение');
            if (modal) modal.style.display = 'none';
            this.pendingSentDeleteId = null;
        } finally {
            this.sentDeleteInProgress = false;
            if (confirmButton) {
                confirmButton.disabled = false;
                confirmButton.textContent = buttonText || 'Удалить';
            }
            if (cancelButton) cancelButton.disabled = false;
        }
    },

    refreshReminders: async function() {
        if (this.remindersRefreshInProgress) return;
        this.remindersRefreshInProgress = true;

        try {
            const scheduledList = document.getElementById('scheduled-list');
            const scheduledPlaceholder = document.getElementById('scheduled-placeholder');
            const scheduledCount = document.getElementById('scheduled-count');
            const sentList = document.getElementById('sent-list');
            const sentPlaceholder = document.getElementById('sent-placeholder');
    
            const reminders = await App.getReminders();
            const scheduled = reminders
                .filter(r => r.status === 'scheduled')
                .sort((a, b) => {
                    const aTime = a.scheduled_time ? (Date.parse(String(a.scheduled_time).replace(' ', 'T')) || Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
                    const bTime = b.scheduled_time ? (Date.parse(String(b.scheduled_time).replace(' ', 'T')) || Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
                    return aTime - bTime || Number(a.id) - Number(b.id);
                });
            const sent = reminders
                .filter(r => r.status === 'sent')
                .sort((a, b) => {
                    const aTime = Date.parse(String(a.sent_at || a.created_at || '').replace(' ', 'T')) || 0;
                    const bTime = Date.parse(String(b.sent_at || b.created_at || '').replace(' ', 'T')) || 0;
                    return bTime - aTime || Number(b.id) - Number(a.id);
                });
    
            if (scheduledCount) scheduledCount.textContent = scheduled.length;
            const sentCount = document.getElementById('sent-count');
            if (sentCount) sentCount.textContent = sent.length;
    
            if (scheduledList && scheduledPlaceholder) {
                scheduledList.innerHTML = '';
                if (scheduled.length === 0) {
                    scheduledPlaceholder.style.display = 'flex';
                    scheduledList.style.display = 'none';
                } else {
                    scheduledPlaceholder.style.display = 'none';
                    scheduledList.style.display = 'flex';
                    const recentScheduled = scheduled.slice(0, 5);
                    recentScheduled.forEach(item => {
                        let displayTime = 'Запланировано';
                        if (item.scheduled_time) {
                            const parts = item.scheduled_time.split('T');
                            if (parts.length === 2) {
                                const dateParts = parts[0].split('-');
                                if (dateParts.length === 3) {
                                    displayTime = `${dateParts[2]}.${dateParts[1]} в ${parts[1]} МСК`;
                                }
                            }
                        }
    
                        const el = document.createElement('div');
                        el.className = 'reminder-item scheduled-reminder-item';
                        el.innerHTML = `
                            <div class="reminder-item-header">
                                <span class="reminder-item-title">${App.escapeHtml(item.title)}</span>
                                <span class="reminder-item-time">${App.escapeHtml(displayTime)}</span>
                            </div>
                            <div class="reminder-item-desc">${App.escapeHtml(item.description)}</div>
                            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
                                <button class="group-share-btn edit-reminder-btn" style="background-color: #e5f2ff; color: #007aff;" data-id="${item.id}">Изменить</button>
                                <button class="group-share-btn cancel-reminder-btn" style="background-color: #ffe5e5; color: #ff3b30;" data-id="${item.id}">Отменить</button>
                            </div>
                        `;
    
                        el.querySelector('.edit-reminder-btn').addEventListener('click', () => {
                            CreateScreen.populateForEdit(item);
                            App.showScreen('create');
                        });
    
                        el.querySelector('.cancel-reminder-btn').addEventListener('click', async () => {
                            const result = await App.deleteReminder(item.id);
                            if (result && result.error) {
                                App.showToast(result.error);
                                return;
                            }
                            App.showToast('Запланированное напоминание отменено');
                            await this.refreshReminders();
                        });
    
                        scheduledList.appendChild(el);
                    });
                }
            }
    
            if (sentList && sentPlaceholder) {
                sentList.innerHTML = '';
                const recentSent = sent.slice(0, 5);
                if (recentSent.length === 0) {
                    sentPlaceholder.style.display = 'flex';
                    sentList.style.display = 'none';
                } else {
                    sentPlaceholder.style.display = 'none';
                    sentList.style.display = 'flex';
                    recentSent.forEach(item => {
                        const el = document.createElement('div');
                        el.className = 'reminder-item sent-reminder-item';
                        const sentTime = this.formatSentTime(item);
                        const recipientsText = this.formatSentRecipients(item.recipients);
                        el.innerHTML = `
                            <div class="reminder-item-header">
                                <span class="reminder-item-title">${App.escapeHtml(item.title)}</span>
                                <span class="reminder-item-time">${App.escapeHtml(sentTime)}</span>
                            </div>
                            <div class="reminder-item-desc">${App.escapeHtml(item.description)}</div>
                            <div class="sent-reminder-meta"><strong>Получатели:</strong> ${App.escapeHtml(recipientsText || 'Не указаны')}</div>
                            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
                                ${'<button class="group-share-btn feedback-sent-reminder-btn" style="background-color: #e9e7ff; color: #6554c0;"><span>Обратная связь</span>' + (Number(item.feedback_unread_count) > 0 ? '<span class="feedback-response-count">' + Number(item.feedback_unread_count) + '</span>' : '') + (Number(item.question_unread_count) > 0 ? '<span class="feedback-question-count">' + Number(item.question_unread_count) + '</span>' : '') + '</button>'}
                                <button class="group-share-btn edit-sent-reminder-btn" style="background-color: #e5f2ff; color: #007aff;">Изменить</button>
                                <button class="group-share-btn delete-sent-reminder-btn" style="background-color: #ffe5e5; color: #ff3b30;">Удалить</button>
                            </div>
                        `;
                        const feedbackButton = el.querySelector('.feedback-sent-reminder-btn');
                        if (feedbackButton) feedbackButton.addEventListener('click', () => this.openFeedbackResults(item));
                        el.querySelector('.edit-sent-reminder-btn').addEventListener('click', () => {
                            CreateScreen.populateForSentEdit(item);
                            App.showScreen('create');
                        });
                        el.querySelector('.delete-sent-reminder-btn').addEventListener('click', () => {
                            this.openSentDeleteModal(item);
                        });
                        sentList.appendChild(el);
                    });
                }
            }
    
    
        } catch (error) {
            console.error('Failed to refresh reminders:', error);
        } finally {
            this.remindersRefreshInProgress = false;
        }
    },

    openFeedbackResults: async function(item) {
        const content = document.getElementById('feedback-results-content');
        const title = document.getElementById('feedback-results-reminder-title');
        const subtitle = document.getElementById('feedback-results-reminder-subtitle');
        const pageContent = document.querySelector('.feedback-page-content');
        if (!content) return;

        this.feedbackReminderId = item.id;
        if (title) title.textContent = item.title || 'Ответы получателей';
        if (subtitle) subtitle.textContent = 'Статистика и ответы по отправленному напоминанию';
        if (pageContent) pageContent.scrollTop = 0;
        content.replaceChildren();
        const loading = document.createElement('div');
        loading.className = 'feedback-loading-state';
        loading.textContent = 'Загружаем ответы…';
        content.appendChild(loading);
        App.showScreen('feedbackResults');

        try {
            const data = await App.getFeedback(item.id);
            if (String(this.feedbackReminderId) !== String(item.id)) return;
            this.renderFeedbackResults(data);
            let shouldRefreshReminders = false;
            if (data.latest_question_id > 0) {
                try {
                    await App.markRecipientQuestionsRead(item.id, data.latest_question_id);
                    shouldRefreshReminders = true;
                } catch (readError) {
                    console.error('Failed to mark recipient questions as read:', readError);
                }
            }
            if (data.feedback_enabled) {
                try {
                    await App.markFeedbackRead(item.id, data.latest_submission_id);
                    shouldRefreshReminders = true;
                } catch (readError) {
                    console.error('Failed to mark feedback as read:', readError);
                }
            }
            if (shouldRefreshReminders) await this.refreshReminders();
        } catch (error) {
            content.replaceChildren();
            const state = document.createElement('div');
            state.className = 'feedback-empty-state feedback-error-state';
            const heading = document.createElement('strong');
            heading.textContent = 'Не удалось загрузить обратную связь';
            const description = document.createElement('p');
            description.textContent = error.message || 'Проверьте соединение и попробуйте ещё раз.';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'feedback-retry-btn';
            retry.textContent = 'Повторить';
            retry.addEventListener('click', () => this.openFeedbackResults(item));
            state.append(heading, description, retry);
            content.appendChild(state);
        }
    },

    openRecipientQuestionDeleteModal: function(questionId) {
        const modal = document.getElementById('recipient-question-delete-modal');
        if (!modal || this.recipientQuestionDeleteInProgress) return;
        this.pendingRecipientQuestionDeleteId = questionId;
        modal.style.display = 'flex';
    },

    closeRecipientQuestionDeleteModal: function() {
        if (this.recipientQuestionDeleteInProgress) return;
        const modal = document.getElementById('recipient-question-delete-modal');
        if (modal) modal.style.display = 'none';
        this.pendingRecipientQuestionDeleteId = null;
    },

    confirmRecipientQuestionDelete: async function() {
        if (this.pendingRecipientQuestionDeleteId === null || this.recipientQuestionDeleteInProgress) return;
        const modal = document.getElementById('recipient-question-delete-modal');
        const confirmButton = document.getElementById('recipient-question-delete-confirm');
        const cancelButton = document.getElementById('recipient-question-delete-cancel');
        const buttonText = confirmButton ? confirmButton.textContent : '';
        this.recipientQuestionDeleteInProgress = true;
        if (confirmButton) {
            confirmButton.disabled = true;
            confirmButton.textContent = 'Удаление…';
        }
        if (cancelButton) cancelButton.disabled = true;
        try {
            await App.deleteRecipientQuestion(this.feedbackReminderId, this.pendingRecipientQuestionDeleteId);
            if (modal) modal.style.display = 'none';
            this.pendingRecipientQuestionDeleteId = null;
            App.showToast('Вопрос удалён');
            const currentTitle = document.getElementById('feedback-results-reminder-title')?.textContent || '';
            await this.openFeedbackResults({ id: this.feedbackReminderId, title: currentTitle });
        } catch (error) {
            App.showToast(error.message || 'Не удалось удалить вопрос');
        } finally {
            this.recipientQuestionDeleteInProgress = false;
            if (confirmButton) {
                confirmButton.disabled = false;
                confirmButton.textContent = buttonText || 'Удалить';
            }
            if (cancelButton) cancelButton.disabled = false;
        }
    },

    exportFeedbackWorkbook: async function() {
        if (!this.feedbackReminderId || this.feedbackExportInProgress) return;
        const button = document.querySelector('.feedback-export-button');
        this.feedbackExportInProgress = true;
        if (button) {
            button.disabled = true;
            button.textContent = 'Готовим Excel…';
        }
        try {
            const result = await App.getFeedbackExport(this.feedbackReminderId);
            const objectUrl = URL.createObjectURL(result.blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = result.filename || ('feedback-' + this.feedbackReminderId + '.xlsx');
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            App.showToast('Excel-файл подготовлен');
        } catch (error) {
            App.showToast(error.message || 'Не удалось экспортировать ответы');
        } finally {
            this.feedbackExportInProgress = false;
            if (button) {
                button.disabled = false;
                button.textContent = 'Скачать Excel';
            }
        }
    },

    renderFeedbackResults: function(data) {
        const content = document.getElementById('feedback-results-content');
        if (!content) return;
        content.replaceChildren();

        const total = Math.max(0, Number(data.total_recipients) || 0);
        const responded = Math.max(0, Number(data.responded) || 0);
        const responsePercent = Math.max(0, Math.min(100, Number(data.response_percent) || 0));
        const options = Array.isArray(data.options) ? data.options : [];
        this.feedbackExportInProgress = false;
        const submissions = Array.isArray(data.submissions) ? data.submissions : [];
        const files = Array.isArray(data.files) ? data.files : [];
        const uniqueFileRecipients = new Set(files.map(entry => String(entry.chat_id))).size;
        const filePercent = Math.max(0, Math.min(100, Number(data.file_percent) || 0));
        const questions = Array.isArray(data.questions) ? data.questions : [];

        const createNode = (tag, className, text) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };

        const hero = document.querySelector('.feedback-page-hero');
        if (hero) hero.style.display = data.feedback_enabled === false ? 'none' : '';
        if (data.feedback_enabled === false) {
            this.renderRecipientQuestionsSection(content, questions, createNode);
            return;
        }

        if (data.feedback_enabled !== false && hero) {
            hero.querySelector('.feedback-export-toolbar')?.remove();
            const exportToolbar = createNode('div', 'feedback-export-toolbar');
            const exportButton = createNode('button', 'feedback-export-button', 'Скачать Excel');
            exportButton.type = 'button';
            exportButton.addEventListener('click', () => this.exportFeedbackWorkbook());
            exportToolbar.appendChild(exportButton);
            hero.appendChild(exportToolbar);
        }

        const createProgress = value => {
            const track = createNode('div', 'feedback-progress-track');
            const fill = createNode('div', 'feedback-progress-fill');
            fill.style.width = Math.max(0, Math.min(100, Number(value) || 0)) + '%';
            track.appendChild(fill);
            return track;
        };

        const overview = createNode('section', 'feedback-overview-grid');
        const responseCard = createNode('article', 'feedback-stat-card feedback-stat-card-primary');
        responseCard.appendChild(createNode('span', 'feedback-stat-label', 'ОТВЕТИЛИ'));
        responseCard.appendChild(createNode('strong', 'feedback-stat-value', responsePercent + '%'));
        responseCard.appendChild(createNode('span', 'feedback-stat-description', responded + ' из ' + total + ' получателей'));
        responseCard.appendChild(createProgress(responsePercent));
        overview.appendChild(responseCard);

        if (data.feedback_allow_files === true) {
            const filesCard = createNode('article', 'feedback-stat-card');
            filesCard.appendChild(createNode('span', 'feedback-stat-label', 'ПРИКРЕПИЛИ ФАЙЛЫ'));
            filesCard.appendChild(createNode('strong', 'feedback-stat-value', filePercent + '%'));
            filesCard.appendChild(createNode('span', 'feedback-stat-description', uniqueFileRecipients + ' получателей'));
            filesCard.appendChild(createProgress(filePercent));
            overview.appendChild(filesCard);
        }

        const submissionsCard = createNode('article', 'feedback-stat-card');
        submissionsCard.appendChild(createNode('span', 'feedback-stat-label', 'ПОЛУЧЕНО ОТВЕТОВ'));
        submissionsCard.appendChild(createNode('strong', 'feedback-stat-value', String(responded)));
        submissionsCard.appendChild(createNode('span', 'feedback-stat-description', 'из ' + total + ' адресатов'));
        submissionsCard.appendChild(createProgress(responsePercent));
        overview.appendChild(submissionsCard);
        content.appendChild(overview);

        if (options.length) {
            const optionsSection = createNode('section', 'feedback-section');
            const optionsHeading = createNode('div', 'feedback-section-heading');
            const optionsHeadingCopy = createNode('div', 'feedback-section-heading-copy');
            optionsHeadingCopy.appendChild(createNode('h2', '', 'Результаты опроса'));
            optionsHeadingCopy.appendChild(createNode('p', '', 'Распределение выбранных вариантов'));
            optionsHeading.appendChild(optionsHeadingCopy);
            optionsSection.appendChild(optionsHeading);
            options.forEach(option => {
                const card = createNode('article', 'feedback-question-card');
                const optionText = createNode('div', 'feedback-question-text', option.option);
                const stats = createNode('div', 'feedback-question-stats');
                stats.appendChild(createNode('strong', '', (Number(option.percent) || 0) + '%'));
                stats.appendChild(createNode('span', '', (Number(option.count) || 0) + ' из ' + total + ' получателей'));
                card.append(optionText, stats, createProgress(option.percent));
                optionsSection.appendChild(card);
            });
            content.appendChild(optionsSection);
        }

        const answersSection = createNode('section', 'feedback-section feedback-answers-section');
        const answersHeading = createNode('div', 'feedback-section-heading');
        const answersHeadingCopy = createNode('div', 'feedback-section-heading-copy');
        answersHeadingCopy.appendChild(createNode('h2', '', 'Ответы получателей'));
        answersHeadingCopy.appendChild(createNode('p', '', 'Индивидуальные ответы и вложения'));
        answersHeading.appendChild(answersHeadingCopy);
        answersHeading.appendChild(createNode('span', 'feedback-count-badge', String(submissions.length)));
        answersSection.appendChild(answersHeading);

        if (!submissions.length) {
            const empty = createNode('div', 'feedback-empty-state');
            const icon = createNode('div', 'feedback-empty-icon', '…');
            empty.appendChild(icon);
            empty.appendChild(createNode('strong', '', 'Пока нет ответов'));
            empty.appendChild(createNode('p', '', 'Когда получатели отправят обратную связь, их ответы появятся в этом разделе.'));
            answersSection.appendChild(empty);
        } else {
            submissions.forEach(submission => {
                const card = createNode('article', 'feedback-respondent-card');
                const header = createNode('div', 'feedback-respondent-header');
                const person = this.recipientParticipants.find(participant => String(participant.chat_id) === String(submission.chat_id) || String(participant.user_id) === String(submission.chat_id));
                const personName = submission.name || person?.name || 'Получатель';
                header.appendChild(createNode('span', 'feedback-respondent-avatar', personName.trim().slice(0, 1).toUpperCase() || 'П'));
                const personCopy = createNode('div', 'feedback-respondent-copy');
                personCopy.appendChild(createNode('strong', 'feedback-respondent-name', personName));
                const submittedAt = submission.created_at ? new Date(String(submission.created_at).replace(' ', 'T') + 'Z') : null;
                const dateLabel = submittedAt && !Number.isNaN(submittedAt.getTime())
                    ? submittedAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : 'Ответ отправлен';
                personCopy.appendChild(createNode('span', 'feedback-respondent-date', dateLabel));
                header.appendChild(personCopy);
                card.appendChild(header);

                const answerList = createNode('div', 'feedback-answer-list');
                let hasAnswers = false;
                const answers = submission.answers && typeof submission.answers === 'object' ? submission.answers : {};
                if (typeof answers.choice === 'string' && answers.choice.trim()) {
                    hasAnswers = true;
                    const answerItem = createNode('div', 'feedback-answer-item');
                    answerItem.appendChild(createNode('span', 'feedback-answer-question', 'Выбранный вариант'));
                    answerItem.appendChild(createNode('p', 'feedback-answer-text', answers.choice));
                    answerList.appendChild(answerItem);
                }
                if (hasAnswers) {
                    card.appendChild(answerList);
                }

                const respondentFiles = files
                    .filter(entry => String(entry.chat_id) === String(submission.chat_id))
                    .flatMap(entry => Array.isArray(entry.files) ? entry.files : []);
                if (respondentFiles.length) {
                    const attachmentSection = createNode('div', 'feedback-attachments');
                    attachmentSection.appendChild(createNode('span', 'feedback-attachments-title', 'Прикреплённые файлы'));
                    respondentFiles.forEach(file => {
                        const row = createNode('div', 'feedback-file-row');
                        const extension = App.getFileExtension(file.name);
                        const iconType = App.getFileIconType(file.name);
                        row.appendChild(createNode('span', 'feedback-file-type feedback-file-type-' + iconType, extension.slice(0, 5).toUpperCase() || 'FILE'));
                        const fileCopy = createNode('div', 'feedback-file-copy');
                        fileCopy.appendChild(createNode('strong', '', file.name || 'Файл'));
                        const fileSize = Number(file.size) || 0;
                        const sizeLabel = fileSize >= 1024 * 1024
                            ? (fileSize / (1024 * 1024)).toFixed(1) + ' МБ'
                            : Math.max(1, Math.round(fileSize / 1024)) + ' КБ';
                        fileCopy.appendChild(createNode('span', '', sizeLabel));
                        row.appendChild(fileCopy);
                        const download = createNode('button', 'feedback-file-download', 'Скачать');
                        download.type = 'button';
                        download.addEventListener('click', async () => {
                            download.disabled = true;
                            download.textContent = 'Загрузка…';
                            try {
                                const response = await fetch(file.download_url, { headers: App.getAuthHeaders() });
                                if (!response.ok) throw new Error('Не удалось скачать файл');
                                const objectUrl = URL.createObjectURL(await response.blob());
                                const link = document.createElement('a');
                                link.href = objectUrl;
                                link.download = file.name || 'attachment';
                                document.body.appendChild(link);
                                link.click();
                                link.remove();
                                setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
                            } catch (error) {
                                App.showToast(error.message || 'Не удалось скачать файл');
                            } finally {
                                download.disabled = false;
                                download.textContent = 'Скачать';
                            }
                        });
                        row.appendChild(download);
                        attachmentSection.appendChild(row);
                    });
                    card.appendChild(attachmentSection);
                }

                if (!hasAnswers && !respondentFiles.length) {
                    card.appendChild(createNode('p', 'feedback-no-answer', 'Получатель отправил пустой ответ.'));
                }
                answersSection.appendChild(card);
            });
        }

        content.appendChild(answersSection);
        this.renderRecipientQuestionsSection(content, questions, createNode);
    },

    renderRecipientQuestionsSection: function(content, questions, createNode) {
        const section = createNode('section', 'feedback-section feedback-recipient-questions-section');
        const heading = createNode('div', 'feedback-section-heading');
        const copy = createNode('div', 'feedback-section-heading-copy');
        copy.appendChild(createNode('h2', '', 'Вопросы получателей'));
        copy.appendChild(createNode('p', '', 'Общие вопросы, видимые всем получателям'));
        heading.appendChild(copy);
        heading.appendChild(createNode('span', 'feedback-count-badge', String(questions.length)));
        section.appendChild(heading);

        if (!questions.length) {
            const empty = createNode('div', 'feedback-empty-state');
            empty.appendChild(createNode('div', 'feedback-empty-icon', '?'));
            empty.appendChild(createNode('strong', '', 'Пока нет вопросов'));
            empty.appendChild(createNode('p', '', 'Когда получатели зададут вопрос, он появится здесь.'));
            section.appendChild(empty);
        } else {
            questions.forEach(question => {
                const answered = Boolean(String(question.answer || '').trim());
                const card = createNode('article', 'feedback-question-card feedback-recipient-question-card' + (answered ? '' : ' is-unanswered'));
                const header = createNode('div', 'feedback-recipient-question-header');
                const name = String(question.recipient_name || 'Получатель');
                header.appendChild(createNode('span', 'feedback-respondent-avatar', name.trim().slice(0, 1).toUpperCase() || 'П'));
                const author = createNode('div', 'feedback-respondent-copy');
                author.appendChild(createNode('strong', 'feedback-respondent-name', name));
                const createdAt = question.created_at ? new Date(String(question.created_at).replace(' ', 'T') + 'Z') : null;
                const dateLabel = createdAt && !Number.isNaN(createdAt.getTime())
                    ? createdAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : 'Вопрос отправлен';
                author.appendChild(createNode('span', 'feedback-respondent-date', dateLabel));
                header.appendChild(author);
                card.appendChild(header);
                card.appendChild(createNode('div', 'feedback-question-text', question.question || ''));
                card.appendChild(createNode('span', 'feedback-question-status ' + (answered ? 'is-answered' : 'is-unanswered'), answered ? 'Есть ответ' : 'Ждёт ответа'));

                if (answered) {
                    const answer = createNode('div', 'feedback-recipient-question-answer');
                    answer.appendChild(createNode('strong', '', 'Ответ'));
                    answer.appendChild(createNode('p', 'feedback-answer-text', question.answer));
                    card.appendChild(answer);
                }

                const actions = createNode('div', 'feedback-recipient-question-actions');
                if (!answered) {
                    const answerButton = createNode('button', 'feedback-question-action feedback-question-answer-button', 'Ответить');
                    answerButton.type = 'button';
                    answerButton.addEventListener('click', () => {
                        if (card.querySelector('.feedback-question-answer-form')) return;
                        const form = createNode('form', 'feedback-question-answer-form');
                        const input = createNode('textarea', 'feedback-question-answer-input');
                        input.maxLength = 1000;
                        input.required = true;
                        input.placeholder = 'Напишите ответ получателю';
                        const submit = createNode('button', 'feedback-question-action feedback-question-submit', 'Отправить');
                        submit.type = 'submit';
                        form.append(input, submit);
                        form.addEventListener('submit', async event => {
                            event.preventDefault();
                            const answerText = input.value.trim();
                            if (!answerText) return;
                            submit.disabled = true;
                            submit.textContent = 'Отправка…';
                            try {
                                await App.answerRecipientQuestion(this.feedbackReminderId, question.id, answerText);
                                App.showToast('Ответ отправлен получателю');
                                const currentTitle = document.getElementById('feedback-results-reminder-title')?.textContent || '';
                                await this.openFeedbackResults({ id: this.feedbackReminderId, title: currentTitle });
                            } catch (error) {
                                App.showToast(error.message || 'Не удалось отправить ответ');
                                submit.disabled = false;
                                submit.textContent = 'Отправить';
                            }
                        });
                        card.appendChild(form);
                        input.focus();
                    });
                    actions.appendChild(answerButton);
                }
                const deleteButton = createNode('button', 'feedback-question-action feedback-question-delete', 'Удалить');
                deleteButton.type = 'button';
                deleteButton.addEventListener('click', () => this.openRecipientQuestionDeleteModal(question.id));
                actions.appendChild(deleteButton);
                card.appendChild(actions);
                section.appendChild(card);
            });
        }

        content.appendChild(section);
    },

    loadRecipientsData: async function() {
        this.recipientDataRequestId += 1;
        const requestId = this.recipientDataRequestId;
        const [groups, participants, botInfo] = await Promise.all([
            App.getGroups(),
            App.getParticipants(),
            App.getBotInfo()
        ]);
        if (requestId !== this.recipientDataRequestId) return;
        this.recipientGroups = groups;
        this.recipientParticipants = participants;

        const homeGroupsCount = document.getElementById('home-groups-count');
        const tabGroupsCount = document.getElementById('tab-groups-count');
        const tabPeopleCount = document.getElementById('tab-people-count');

        if (homeGroupsCount) homeGroupsCount.textContent = groups.length;
        if (tabGroupsCount) tabGroupsCount.textContent = groups.length;
        if (tabPeopleCount) tabPeopleCount.textContent = participants.length;

        const groupsList = document.getElementById('groups-list');
        if (groupsList) {
            groupsList.innerHTML = '';

            if (groups.length === 0) {
                groupsList.innerHTML = `
                    <div class="recipient-empty-state">
                        <div class="recipient-empty-icon">01</div>
                        <strong>Пока нет ни одной группы</strong>
                        <p>Введите название группы выше и нажмите «Создать». Затем откройте её и отправьте приглашение участникам.</p>
                    </div>
                `;
            } else {
                groups.forEach(g => {
                    const card = document.createElement('div');
                    card.className = 'group-card';
                    card.style.flexDirection = 'column';
                    card.style.alignItems = 'stretch';
                    card.style.gap = '10px';

                    const inviteUrl = 'https://max.ru/' + encodeURIComponent(botInfo.username) + '?start=group_' + g.unique_id;
                    const isExpanded = Boolean(this.expandedGroupIds[g.id]);
                    const groupParticipants = participants.filter(p => {
                        if (Array.isArray(p.groups)) {
                            return p.groups.some(group => Number(group.id) === Number(g.id));
                        }
                        return Number(p.group_id) === Number(g.id);
                    });
                    const participantCount = groupParticipants.length;

                    let participantsHtml = '';
                    if (isExpanded) {
                        if (groupParticipants.length === 0) {
                            participantsHtml = `
                                <div class="group-empty-members">
                                    Пока нет участников. Отправьте ссылку-приглашение выше.
                                </div>
                            `;
                        } else {
                            participantsHtml = '<div class="group-participants-container">';
                            groupParticipants.forEach(gp => {
                                participantsHtml += `
                                    <div class="group-participant-row">
                                        <span class="group-participant-name">${App.escapeHtml(gp.name)}</span>
                                        <button type="button" class="group-remove-member-btn" data-remove-id="${gp.id}">
                                            Убрать из группы
                                        </button>
                                    </div>
                                `;
                            });
                            participantsHtml += '</div>';
                        }
                    }

                    card.innerHTML = `
                        <div class="group-header-toggle" data-group-id="${g.id}" role="button" tabindex="0"
                             aria-expanded="${isExpanded}" aria-label="${isExpanded ? 'Скрыть' : 'Показать'} участников группы ${App.escapeHtml(g.name)}">
                            <div class="group-info">
                                <div class="group-title">${App.escapeHtml(g.name)}</div>
                                <div class="group-sub">${participantCount} участников</div>
                            </div>
                            <span class="group-expand-indicator">
                                ${isExpanded ? 'Скрыть состав' : 'Показать состав'}
                                <span class="group-expand-chevron ${isExpanded ? 'expanded' : ''}"></span>
                            </span>
                        </div>

                        <div class="group-actions">
                            <button type="button" class="group-share-btn" data-url="${App.escapeHtml(inviteUrl)}">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"></path><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"></path></svg>
                                <span>Отправить приглашение</span>
                            </button>
                            <button type="button" class="group-delete-btn" data-id="${g.id}"
                                    aria-label="Удалить группу ${App.escapeHtml(g.name)}" title="Удалить группу">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>

                        <div class="group-invite-area">
                            <div class="group-link-caption">Ссылка для приглашения</div>
                            <div class="group-link-box">
                                <input type="text" class="group-link-input" value="${App.escapeHtml(inviteUrl)}" readonly
                                       aria-label="Пригласительная ссылка для группы ${App.escapeHtml(g.name)}">
                                <button type="button" class="group-copy-btn">Копировать ссылку</button>
                            </div>
                        </div>
                        ${participantsHtml}
                    `;

                    const groupHeader = card.querySelector('.group-header-toggle');
                    const toggleGroup = () => {
                        this.expandedGroupIds[g.id] = !this.expandedGroupIds[g.id];
                        this.loadRecipientsData();
                    };

                    groupHeader.addEventListener('click', toggleGroup);
                    groupHeader.addEventListener('keydown', event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleGroup();
                        }
                    });

                    card.querySelectorAll('[data-remove-id]').forEach(btn => {
                        btn.addEventListener('click', async event => {
                            event.stopPropagation();
                            const pId = btn.getAttribute('data-remove-id');
                            await App.removeParticipantFromGroup(pId, g.id);
                            App.showToast('Участник убран из группы');
                            await this.loadRecipientsData();
                        });
                    });

                    card.querySelector('.group-copy-btn').addEventListener('click', () => {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(inviteUrl).then(() => {
                                App.showToast('Ссылка скопирована');
                            }).catch(() => {
                                const linkInput = card.querySelector('.group-link-input');
                                if (linkInput) {
                                    linkInput.focus();
                                    linkInput.select();
                                }
                                App.showToast('Ссылка выделена для копирования');
                            });
                        } else {
                            const linkInput = card.querySelector('.group-link-input');
                            if (linkInput) {
                                linkInput.focus();
                                linkInput.select();
                            }
                            App.showToast('Ссылка выделена для копирования');
                        }
                    });

                    card.querySelector('.group-share-btn').addEventListener('click', async () => {
                        const shareText = 'Приглашение в группу "' + g.name + '":';
                        if (window.WebApp && typeof window.WebApp.shareMaxContent === 'function') {
                            try {
                                await window.WebApp.shareMaxContent({ text: shareText, link: inviteUrl });
                            } catch (e) {}
                        } else if (window.WebApp && typeof window.WebApp.openMaxLink === 'function') {
                            window.WebApp.openMaxLink(inviteUrl);
                        } else {
                            const linkInput = card.querySelector('.group-link-input');
                            if (linkInput) {
                                linkInput.focus();
                                linkInput.select();
                            }
                            App.showToast('Ссылка выделена для копирования');
                        }
                    });

                    card.querySelector('.group-delete-btn').addEventListener('click', async () => {
                        try {
                            await App.deleteGroup(g.id);
                            App.showToast('Группа удалена. Участники остались в списке');
                            await this.loadRecipientsData();
                        } catch (error) {
                            App.showToast(error.message || 'Не удалось удалить группу');
                        }
                    });

                    groupsList.appendChild(card);
                });
            }
        }

        const assignmentGroupsList = document.getElementById('assignment-groups-list');
        this.selectedGroupIds = this.selectedGroupIds.filter(id => groups.some(group => String(group.id) === String(id)));

        if (assignmentGroupsList) {
            assignmentGroupsList.innerHTML = '';
            if (groups.length === 0) {
                assignmentGroupsList.innerHTML = '<div class="assignment-groups-empty">Сначала создайте хотя бы одну группу.</div>';
            } else {
                groups.forEach(group => {
                    const isChecked = this.selectedGroupIds.includes(String(group.id));
                    const option = document.createElement('label');
                    option.className = 'assignment-group-option' + (isChecked ? ' selected' : '');
                    option.innerHTML = `
                        <input type="checkbox" value="${group.id}" ${isChecked ? 'checked' : ''}>
                        <span class="assignment-group-check" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </span>
                        <span class="assignment-group-name">${App.escapeHtml(group.name)}</span>
                    `;
                    const checkbox = option.querySelector('input');
                    checkbox.addEventListener('change', () => {
                        const groupId = String(group.id);
                        if (checkbox.checked) {
                            if (!this.selectedGroupIds.includes(groupId)) this.selectedGroupIds.push(groupId);
                        } else {
                            this.selectedGroupIds = this.selectedGroupIds.filter(id => id !== groupId);
                        }
                        option.classList.toggle('selected', checkbox.checked);
                        renderParticipantsList();
                    });
                    assignmentGroupsList.appendChild(option);
                });
            }
        }

        const renderParticipantsList = () => {
            const participantsList = document.getElementById('participants-list');
            if (!participantsList) return;
            participantsList.innerHTML = '';

            const selectedCount = document.getElementById('selected-participants-count');
            const submitButton = document.getElementById('combine-submit-btn');
            const updateSelectionSummary = () => {
                const count = this.selectedParticipantIds.length;
                if (selectedCount) selectedCount.textContent = count;
                if (submitButton) submitButton.disabled = this.selectedGroupIds.length === 0 || count === 0;
            };

            if (participants.length === 0) {
                participantsList.innerHTML = `
                    <div class="recipient-empty-state">
                        <strong>Пока нет контактов</strong>
                        <p>Поделитесь ссылкой-приглашением любой группы. Каждый, кто перейдёт по ней, появится здесь — даже если позже группа будет удалена.</p>
                    </div>
                `;
                updateSelectionSummary();
                return;
            }

            participants.forEach(participant => {
                const isSelected = this.selectedParticipantIds.includes(String(participant.id));
                const item = document.createElement('div');
                item.className = 'participant-item' + (isSelected ? ' selected' : '');
                const currentGroups = Array.isArray(participant.groups)
                    ? participant.groups.map(group => group.name)
                    : (participant.group_name ? [participant.group_name] : []);
                const currentGroupsText = currentGroups.length
                    ? 'Сейчас в группах: ' + currentGroups.join(', ')
                    : 'Пока без группы';

                item.innerHTML = `
                    <button type="button" class="participant-select-button" aria-pressed="${isSelected}">
                        <span class="recipient-check ${isSelected ? '' : 'unchecked'}">
                            <svg width="12" height="12" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </span>
                        <span class="contact-modal-info participant-main-info">
                            <span class="participant-name">${App.escapeHtml(participant.name)}</span>
                            <span class="participant-group">${App.escapeHtml(currentGroupsText)}</span>
                        </span>
                        <span class="participant-selection-label">${isSelected ? 'Выбран' : 'Выбрать'}</span>
                    </button>
                    <button type="button" class="group-delete-btn" data-id="${participant.id}"
                            aria-label="Удалить участника ${App.escapeHtml(participant.name)}" title="Удалить участника">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                `;

                const toggleParticipant = () => {
                    const participantId = String(participant.id);
                    if (this.selectedParticipantIds.includes(participantId)) {
                        this.selectedParticipantIds = this.selectedParticipantIds.filter(id => id !== participantId);
                    } else {
                        this.selectedParticipantIds.push(participantId);
                    }
                    renderParticipantsList();
                };

                item.querySelector('.participant-select-button').addEventListener('click', toggleParticipant);
                item.querySelector('.group-delete-btn').addEventListener('click', async event => {
                    event.stopPropagation();
                    try {
                        await App.deleteParticipant(participant.id);
                        this.selectedParticipantIds = this.selectedParticipantIds.filter(id => id !== String(participant.id));
                        App.showToast('Участник удалён');
                        await this.loadRecipientsData();
                    } catch (error) {
                        App.showToast(error.message || 'Не удалось удалить участника');
                    }
                });
                participantsList.appendChild(item);
            });

            updateSelectionSummary();
        };

        renderParticipantsList();
    },

    refreshRecipients: async function() {
        if (this.recipientRefreshInProgress) return;
        const isRecipientsScreen = App.currentScreen === 'home' || App.currentScreen === 'recipients';
        const isRecipientWizard = App.currentScreen === 'create'
            && typeof CreateScreen !== 'undefined'
            && CreateScreen.wizardActive
            && CreateScreen.wizardStep === 2;
        if (!isRecipientsScreen && !isRecipientWizard) return;

        this.recipientRefreshInProgress = true;
        try {
            if (isRecipientWizard) {
                await CreateScreen.refreshRecipientOptions();
            } else {
                await this.loadRecipientsData();
            }
        } catch (error) {
            console.error('Failed to refresh recipients:', error);
        } finally {
            this.recipientRefreshInProgress = false;
        }
    },

    refreshVisibleData: function() {
        if (document.hidden) return;
        if (App.currentScreen === 'home') this.refreshReminders();
        this.refreshRecipients();
    },

    init: function() {
        const feedbackBackButton = document.getElementById('feedback-results-back-btn');
        if (feedbackBackButton) {
            feedbackBackButton.addEventListener('click', () => App.showScreen('home'));
        }
        const sentDeleteModal = document.getElementById('sent-delete-modal');
        const sentDeleteCancel = document.getElementById('sent-delete-cancel');
        const sentDeleteConfirm = document.getElementById('sent-delete-confirm');
        const questionDeleteModal = document.getElementById('recipient-question-delete-modal');
        const questionDeleteCancel = document.getElementById('recipient-question-delete-cancel');
        const questionDeleteConfirm = document.getElementById('recipient-question-delete-confirm');

        if (questionDeleteCancel) {
            questionDeleteCancel.addEventListener('click', () => this.closeRecipientQuestionDeleteModal());
        }
        if (questionDeleteConfirm) {
            questionDeleteConfirm.addEventListener('click', () => this.confirmRecipientQuestionDelete());
        }
        if (questionDeleteModal) {
            questionDeleteModal.addEventListener('click', event => {
                if (event.target === questionDeleteModal) this.closeRecipientQuestionDeleteModal();
            });
        }

        if (sentDeleteCancel) {
            sentDeleteCancel.addEventListener('click', () => this.closeSentDeleteModal());
        }
        if (sentDeleteConfirm) {
            sentDeleteConfirm.addEventListener('click', () => this.confirmSentDelete());
        }
        if (sentDeleteModal) {
            sentDeleteModal.addEventListener('click', event => {
                if (event.target === sentDeleteModal) this.closeSentDeleteModal();
            });
        }
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                this.closeSentDeleteModal();
                this.closeRecipientQuestionDeleteModal();
            }
        });

        const scrollContainer = document.getElementById('templates-scroll');
        const scrollLeftBtn = document.getElementById('scroll-left-btn');
        const scrollRightBtn = document.getElementById('scroll-right-btn');
        const homeAddCard = document.getElementById('home-add-template-card');

        if (scrollLeftBtn && scrollRightBtn && scrollContainer) {
            const scrollTemplates = direction => {
                const distance = Math.max(180, Math.round(scrollContainer.clientWidth * 0.72));
                scrollContainer.scrollBy({ left: direction * distance, behavior: 'smooth' });
            };

            scrollLeftBtn.addEventListener('click', () => scrollTemplates(-1));
            scrollRightBtn.addEventListener('click', () => scrollTemplates(1));
            scrollContainer.addEventListener('scroll', () => this.updateTemplateScrollControls(), { passive: true });
            window.addEventListener('resize', () => this.updateTemplateScrollControls(), { passive: true });
            this.updateTemplateScrollControls();
        }

        if (homeAddCard) {
            homeAddCard.addEventListener('click', () => {
                App.openCreateTemplateModal();
            });
        }

        ['scheduled', 'sent'].forEach(section => {
            const toggle = document.getElementById(section + '-toggle');
            const content = document.getElementById(section + '-section-content');
            if (!toggle || !content) return;

            toggle.addEventListener('click', () => {
                const expanded = toggle.getAttribute('aria-expanded') !== 'true';
                this.expandedReminderSections[section] = expanded;
                toggle.setAttribute('aria-expanded', String(expanded));
                content.hidden = !expanded;
            });
        });

        const showRecipientsBtn = document.getElementById('show-recipients-btn');
        if (showRecipientsBtn) {
            showRecipientsBtn.addEventListener('click', () => {
                App.showScreen('recipients');
            });
        }

        const recipientsBackBtn = document.getElementById('recipients-back-btn');
        if (recipientsBackBtn) {
            recipientsBackBtn.addEventListener('click', () => {
                const target = App.recipientsReturnScreen || 'home';
                App.recipientsReturnScreen = null;
                App.showScreen(target);
                if (target === 'create') CreateScreen.loadRecipientOptions();
            });
        }

        const tabGroupsBtn = document.getElementById('tab-groups-btn');
        const tabPeopleBtn = document.getElementById('tab-people-btn');
        const tabGroupsContent = document.getElementById('tab-groups-content');
        const tabPeopleContent = document.getElementById('tab-people-content');

        if (tabGroupsBtn && tabPeopleBtn && tabGroupsContent && tabPeopleContent) {
            tabGroupsBtn.addEventListener('click', () => {
                tabGroupsBtn.classList.add('active');
                tabPeopleBtn.classList.remove('active');
                tabGroupsBtn.setAttribute('aria-selected', 'true');
                tabPeopleBtn.setAttribute('aria-selected', 'false');
                tabGroupsContent.style.display = 'flex';
                tabPeopleContent.style.display = 'none';
            });

            tabPeopleBtn.addEventListener('click', () => {
                tabPeopleBtn.classList.add('active');
                tabGroupsBtn.classList.remove('active');
                tabPeopleBtn.setAttribute('aria-selected', 'true');
                tabGroupsBtn.setAttribute('aria-selected', 'false');
                tabPeopleContent.style.display = 'flex';
                tabGroupsContent.style.display = 'none';
            });
        }

        const createGroupBtn = document.getElementById('create-group-btn');
        const newGroupNameInput = document.getElementById('new-group-name-input');
        if (createGroupBtn && newGroupNameInput) {
            createGroupBtn.addEventListener('click', async () => {
                const name = newGroupNameInput.value.trim();
                if (!name) {
                    App.showToast('Введите название группы');
                    return;
                }
                await App.saveGroup(name);
                newGroupNameInput.value = '';
                App.showToast('Группа создана');
                this.loadRecipientsData();
            });
        }

        const combineSubmitBtn = document.getElementById('combine-submit-btn');
        if (combineSubmitBtn) {
            combineSubmitBtn.addEventListener('click', async () => {
                const groupIds = [...this.selectedGroupIds];
                const participantIds = [...this.selectedParticipantIds];
                if (groupIds.length === 0) {
                    App.showToast('Выберите хотя бы одну группу');
                    return;
                }
                if (participantIds.length === 0) {
                    App.showToast('Отметьте хотя бы одного участника в списке');
                    return;
                }

                combineSubmitBtn.disabled = true;
                try {
                    const result = await App.addParticipantsToGroups(participantIds, groupIds);
                    this.selectedParticipantIds = [];
                    App.showToast(result.memberships_added
                        ? 'Участники добавлены в выбранные группы'
                        : 'Эти участники уже состоят в выбранных группах');
                    await this.loadRecipientsData();
                } catch (error) {
                    App.showToast(error.message || 'Не удалось назначить группы');
                    combineSubmitBtn.disabled = false;
                }
            });
        }

        this.loadData();

        if (!this.autoRefreshInterval) {
            this.autoRefreshInterval = setInterval(() => this.refreshVisibleData(), 10000);
        }

        document.addEventListener('visibilitychange', () => this.refreshVisibleData());
        window.addEventListener('focus', () => this.refreshVisibleData());
    }
};

document.addEventListener('DOMContentLoaded', () => {
    HomeScreen.init();
});
