const HomeScreen = {
    selectedParticipantIds: [],
    expandedGroupIds: {},
    remindersRefreshInProgress: false,

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
                const card = document.createElement('div');
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

        await this.refreshReminders();

        this.loadRecipientsData();
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
                const recentSent = sent;
                if (recentSent.length === 0) {
                    sentPlaceholder.style.display = 'flex';
                    sentList.style.display = 'none';
                } else {
                    sentPlaceholder.style.display = 'none';
                    sentList.style.display = 'flex';
                    recentSent.forEach(item => {
                        const el = document.createElement('div');
                        el.className = 'reminder-item';
                        const sentMatch = typeof item.sent_at === 'string'
                            ? item.sent_at.match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/)
                            : null;
                        const sentTime = sentMatch
                            ? sentMatch[3] + '.' + sentMatch[2] + '.' + sentMatch[1] + ' ' + sentMatch[4] + ':' + sentMatch[5] + ' МСК'
                            : 'Дата не сохранена';
                        const recipientsText = Array.isArray(item.recipients) ? item.recipients.join(', ') : '';
                        const repliesHtml = Array.isArray(item.quick_replies) && item.quick_replies.length
                            ? item.quick_replies.map(reply => `<div class="sent-reminder-reply"><strong>${App.escapeHtml(reply.question)}</strong><span>${App.escapeHtml(reply.answer)}</span></div>`).join('')
                            : '<div class="sent-reminder-muted">Быстрых ответов нет</div>';
                        el.innerHTML = `
                            <div class="reminder-item-header">
                                <span class="reminder-item-title">${App.escapeHtml(item.title)}</span>
                                <span class="reminder-item-time">${App.escapeHtml(sentTime)}</span>
                            </div>
                            <div class="reminder-item-desc">${App.escapeHtml(item.description)}</div>
                            <div class="sent-reminder-meta"><strong>Получатели:</strong> ${App.escapeHtml(recipientsText || 'Не указаны')}</div>
                            <div class="sent-reminder-replies"><strong>Быстрые ответы</strong>${repliesHtml}</div>
                            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
                                <button class="group-share-btn edit-sent-reminder-btn" style="background-color: #e5f2ff; color: #007aff;">Изменить</button>
                                <button class="group-share-btn delete-sent-reminder-btn" style="background-color: #ffe5e5; color: #ff3b30;">Удалить</button>
                            </div>
                        `;
                        el.querySelector('.edit-sent-reminder-btn').addEventListener('click', () => {
                            CreateScreen.populateForSentEdit(item);
                            App.showScreen('create');
                        });
                        el.querySelector('.delete-sent-reminder-btn').addEventListener('click', async () => {
                            if (!window.confirm('Удалить сообщение у получателей и убрать его из истории?')) return;
                            const result = await App.deleteReminder(item.id);
                            if (result && result.error) {
                                App.showToast(result.error);
                                return;
                            }
                            App.showToast('Отправленное сообщение удалено');
                            await this.refreshReminders();
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
                            prompt('Скопируйте ссылку на бота:', inviteUrl);
                        });
                    } else {
                        prompt('Скопируйте ссылку на бота:', inviteUrl);
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
                        prompt('Ссылка для вашей группы:', inviteUrl);
                    }
                });

                card.querySelector('.group-delete-btn').addEventListener('click', async () => {
                    await App.deleteGroup(g.id);
                    this.loadRecipientsData();
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
                    await App.deleteParticipant(p.id);
                    this.selectedParticipantIds = this.selectedParticipantIds.filter(id => id !== String(p.id));
                    this.loadRecipientsData();
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
        const scrollContainer = document.getElementById('templates-scroll');
        const scrollLeftBtn = document.getElementById('scroll-left-btn');
        const scrollRightBtn = document.getElementById('scroll-right-btn');
        const homeAddCard = document.getElementById('home-add-template-card');

        if (scrollLeftBtn && scrollRightBtn && scrollContainer) {
            scrollLeftBtn.addEventListener('click', () => {
                scrollContainer.scrollBy({ left: -200, behavior: 'smooth' });
            });

            scrollRightBtn.addEventListener('click', () => {
                scrollContainer.scrollBy({ left: 200, behavior: 'smooth' });
            });
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
