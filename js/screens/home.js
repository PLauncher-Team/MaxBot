const HomeScreen = {
    selectedParticipantIds: [],
    selectedGroupIds: [],
    expandedGroupIds: {},
    remindersRefreshInProgress: false,
    pendingSentDeleteId: null,
    sentDeleteInProgress: false,

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

        const templates = await App.getTemplates();
        if (homeTemplatesCount) {
            homeTemplatesCount.textContent = templates.length;
        }

        if (templatesScroll) {
            templatesScroll.querySelectorAll('.template-card').forEach(el => el.remove());
            templates.forEach(t => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'template-card';
                card.setAttribute('data-id', t.id);
                card.innerHTML = `
                    <div class="template-card-content">
                        <div class="template-title">${App.escapeHtml(t.title)}</div>
                        <div class="template-badge">Шаблон</div>
                    </div>
                `;
                card.addEventListener('click', () => {
                    CreateScreen.startWizard(t);
                });
                templatesScroll.insertBefore(card, addCard);
            });
        }

        this.updateTemplateScrollControls();
        await this.refreshReminders();

        this.loadRecipientsData();
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
            const scheduled = reminders.filter(r => r.status === 'scheduled');
            const sent = reminders.filter(r => r.status === 'sent');
    
            if (scheduledCount) scheduledCount.textContent = scheduled.length;
    
            if (scheduledList && scheduledPlaceholder) {
                scheduledList.innerHTML = '';
                if (scheduled.length === 0) {
                    scheduledPlaceholder.style.display = 'flex';
                    scheduledList.style.display = 'none';
                } else {
                    scheduledPlaceholder.style.display = 'none';
                    scheduledList.style.display = 'flex';
                    scheduled.forEach(item => {
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
                        el.className = 'reminder-item';
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
                const recentSent = sent.slice(0, 3);
                if (recentSent.length === 0) {
                    sentPlaceholder.style.display = 'flex';
                    sentList.style.display = 'none';
                } else {
                    sentPlaceholder.style.display = 'none';
                    sentList.style.display = 'flex';
                    recentSent.forEach(item => {
                        const el = document.createElement('div');
                        el.className = 'reminder-item';
                        const sentTime = this.formatSentTime(item);
                        const recipientsText = Array.isArray(item.recipients) ? item.recipients.join(', ') : '';
                        el.innerHTML = `
                            <div class="reminder-item-header">
                                <span class="reminder-item-title">${App.escapeHtml(item.title)}</span>
                                <span class="reminder-item-time">${App.escapeHtml(sentTime)}</span>
                            </div>
                            <div class="reminder-item-desc">${App.escapeHtml(item.description)}</div>
                            <div class="sent-reminder-meta"><strong>Получатели:</strong> ${App.escapeHtml(recipientsText || 'Не указаны')}</div>
                            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
                                <button class="group-share-btn edit-sent-reminder-btn" style="background-color: #e5f2ff; color: #007aff;">Изменить</button>
                                <button class="group-share-btn delete-sent-reminder-btn" style="background-color: #ffe5e5; color: #ff3b30;">Удалить</button>
                            </div>
                        `;
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

    loadRecipientsData: async function() {
        const groups = await App.getGroups();
        const participants = await App.getParticipants();

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

                    const inviteUrl = 'https://max.ru/se14850760_bot?start=group_' + g.unique_id;
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

            if (groups.length === 0) {
                participantsList.innerHTML = `
                    <div class="recipient-empty-state">
                        <strong>Сначала создайте группу</strong>
                        <p>Перейдите на вкладку «Группы», создайте её и отправьте людям ссылку-приглашение. После присоединения они появятся здесь.</p>
                    </div>
                `;
                updateSelectionSummary();
                return;
            }

            if (participants.length === 0) {
                participantsList.innerHTML = `
                    <div class="recipient-empty-state">
                        <strong>Участников пока нет</strong>
                        <p>Отправьте ссылку-приглашение из карточки группы. Когда человек присоединится, он появится в этом списке.</p>
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

    init: function() {
        const sentDeleteModal = document.getElementById('sent-delete-modal');
        const sentDeleteCancel = document.getElementById('sent-delete-cancel');
        const sentDeleteConfirm = document.getElementById('sent-delete-confirm');

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
            if (event.key === 'Escape') this.closeSentDeleteModal();
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
            this.autoRefreshInterval = setInterval(() => {
                if (App.currentScreen === 'home' && !document.hidden) {
                    this.refreshReminders();
                }
            }, 10000);
        }

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && App.currentScreen === 'home') {
                this.refreshReminders();
            }
        });

        window.addEventListener('focus', () => {
            if (App.currentScreen === 'home') {
                this.refreshReminders();
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    HomeScreen.init();
});
