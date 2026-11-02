const HomeScreen = {
    selectedParticipantIds: [],
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
                    App.selectedTemplate = t;
                    CreateScreen.populateForm(t);
                    App.showScreen('create');
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
            const sentCount = document.getElementById('sent-count');
    
            const reminders = await App.getReminders();
            const scheduled = reminders.filter(r => r.status === 'scheduled');
            const sent = reminders.filter(r => r.status === 'sent');
    
            if (scheduledCount) scheduledCount.textContent = scheduled.length;
            if (sentCount) sentCount.textContent = sent.length;
    
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
            groups.forEach(g => {
                const card = document.createElement('div');
                card.className = 'group-card';
                card.style.flexDirection = 'column';
                card.style.alignItems = 'stretch';
                card.style.gap = '8px';

                const inviteUrl = 'https://max.ru/se14850760_bot?start=group_' + g.unique_id;
                const isExpanded = Boolean(this.expandedGroupIds[g.id]);
                const groupParticipants = participants.filter(p => Number(p.group_id) === Number(g.id));

                let participantsHtml = '';
                if (isExpanded) {
                    if (groupParticipants.length === 0) {
                        participantsHtml = '<div style="font-size:12px; color:#8e8e93; padding:4px 0;">В группе пока нет участников</div>';
                    } else {
                        participantsHtml = '<div class="group-participants-container">';
                        groupParticipants.forEach(gp => {
                            participantsHtml += `
                                <div class="group-participant-row">
                                    <span>${App.escapeHtml(gp.name)}</span>
                                    <button class="group-share-btn" data-remove-id="${gp.id}" style="background-color:#ffe5e5; color:#ff3b30;">Убрать</button>
                                </div>
                            `;
                        });
                        participantsHtml += '</div>';
                    }
                }

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" class="group-header-toggle" data-group-id="${g.id}">
                        <div class="group-info">
                            <div class="group-title">${App.escapeHtml(g.name)} ${isExpanded ? '▲' : '▼'}</div>
                            <div class="group-sub">${g.participant_count || 0} участников</div>
                        </div>
                        <div class="group-actions">
                            <button class="group-share-btn" data-url="${inviteUrl}">Ссылка</button>
                            <button class="group-delete-btn" data-id="${g.id}">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                    <div class="group-link-box">
                        <input type="text" class="group-link-input" value="${App.escapeHtml(inviteUrl)}" readonly>
                        <button class="group-copy-btn">Копировать</button>
                    </div>
                    ${participantsHtml}
                `;

                card.querySelector('.group-header-toggle').addEventListener('click', (e) => {
                    if (e.target.closest('button') || e.target.closest('input')) return;
                    this.expandedGroupIds[g.id] = !isExpanded;
                    this.loadRecipientsData();
                });

                card.querySelectorAll('[data-remove-id]').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const pId = btn.getAttribute('data-remove-id');
                        await App.combineParticipantsToGroup([pId], null);
                        this.loadRecipientsData();
                    });
                });

                card.querySelector('.group-copy-btn').addEventListener('click', () => {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(inviteUrl).then(() => {
                            App.showToast('Ссылка скопирована!');
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
                    const shareText = 'Ссылка для присоединения к группе "' + g.name + '":';
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
                        const result = await App.deleteGroup(g.id);
                        App.showToast('Группа удалена. Участники сохранены без группы');
                        await this.loadRecipientsData();
                    } catch (error) {
                        App.showToast(error.message || 'Не удалось удалить группу');
                    }
                });

                groupsList.appendChild(card);
            });
        }

        const combineSelect = document.getElementById('combine-group-select');
        if (combineSelect) {
            const currentSelectedGroup = combineSelect.value;
            combineSelect.innerHTML = '<option value="">Выбрать группу...</option>';
            groups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = g.name;
                if (String(g.id) === String(currentSelectedGroup)) {
                    opt.selected = true;
                }
                combineSelect.appendChild(opt);
            });
        }

        const renderParticipantsList = () => {
            const participantsList = document.getElementById('participants-list');
            if (!participantsList) return;
            participantsList.innerHTML = '';

            const selectedGroupId = combineSelect ? combineSelect.value : '';
            const filteredParticipants = participants.filter(p => {
                if (!selectedGroupId) return true;
                return Number(p.group_id) !== Number(selectedGroupId);
            });

            if (filteredParticipants.length === 0) {
                participantsList.innerHTML = '<div style="text-align:center; color:#8e8e93; padding:20px; font-size:13px;">Все участники уже добавлены в эту группу</div>';
                return;
            }

            filteredParticipants.forEach(p => {
                const isSelected = this.selectedParticipantIds.includes(String(p.id));
                const item = document.createElement('div');
                item.className = 'participant-item';
                item.innerHTML = `
                    <div class="recipient-check ${isSelected ? '' : 'unchecked'}">
                        <svg width="12" height="12" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <div class="contact-modal-info" style="flex:1;">
                        <div class="participant-name">${App.escapeHtml(p.name)}</div>
                        <div class="participant-group">${p.group_name ? App.escapeHtml(p.group_name) : 'Без группы'}</div>
                    </div>
                    <button class="group-delete-btn" data-id="${p.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                `;

                item.querySelector('.recipient-check').parentElement.addEventListener('click', (e) => {
                    if (e.target.closest('.group-delete-btn')) return;
                    const pIdStr = String(p.id);
                    if (this.selectedParticipantIds.includes(pIdStr)) {
                        this.selectedParticipantIds = this.selectedParticipantIds.filter(id => id !== pIdStr);
                    } else {
                        this.selectedParticipantIds.push(pIdStr);
                    }
                    renderParticipantsList();
                });

                item.querySelector('.group-delete-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await App.deleteParticipant(p.id);
                        this.selectedParticipantIds = this.selectedParticipantIds.filter(id => id !== String(p.id));
                        App.showToast('Участник удалён');
                        await this.loadRecipientsData();
                    } catch (error) {
                        App.showToast(error.message || 'Не удалось удалить участника');
                    }
                });

                participantsList.appendChild(item);
            });
        };

        renderParticipantsList();

        if (combineSelect && !combineSelect.onchange) {
            combineSelect.onchange = () => {
                renderParticipantsList();
            };
        }
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
                App.showScreen('home');
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
                tabGroupsContent.style.display = 'flex';
                tabPeopleContent.style.display = 'none';
            });

            tabPeopleBtn.addEventListener('click', () => {
                tabPeopleBtn.classList.add('active');
                tabGroupsBtn.classList.remove('active');
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
        const combineGroupSelect = document.getElementById('combine-group-select');
        if (combineSubmitBtn && combineGroupSelect) {
            combineSubmitBtn.addEventListener('click', async () => {
                const groupId = combineGroupSelect.value;
                if (!groupId) {
                    App.showToast('Выберите группу для добавления');
                    return;
                }
                if (this.selectedParticipantIds.length === 0) {
                    App.showToast('Выберите хотя бы одного человека');
                    return;
                }

                await App.combineParticipantsToGroup(this.selectedParticipantIds, groupId);
                this.selectedParticipantIds = [];
                App.showToast('Участники добавлены в группу');
                this.loadRecipientsData();
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
