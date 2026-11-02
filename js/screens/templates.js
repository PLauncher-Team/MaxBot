const TemplatesScreen = {
    loadTemplates: async function() {
        const list = document.getElementById('templates-list');
        const count = document.getElementById('templates-count');
        const searchInput = document.getElementById('search-input');
        const emptySearch = document.getElementById('empty-search');

        const templates = await App.getTemplates();
        if (count) {
            count.textContent = templates.length;
        }

        if (!list) return;
        list.innerHTML = '';

        templates.forEach(t => {
            const item = document.createElement('div');
            item.className = 'template-item';
            item.setAttribute('data-id', t.id);
            item.setAttribute('data-title', t.title);
            item.innerHTML = `
                <div class="template-item-top">
                    <div class="template-item-title">${App.escapeHtml(t.title)}</div>
                    <div class="template-item-right">
                        <div class="template-item-badge">Шаблон</div>
                        <button class="template-delete-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            `;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.template-delete-btn')) {
                    return;
                }
                App.selectedTemplate = t;
                CreateScreen.populateForm(t);
                App.showScreen('create');
            });

            const deleteBtn = item.querySelector('.template-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await App.deleteTemplate(t.id);
                    await this.loadTemplates();
                    if (typeof HomeScreen !== 'undefined' && HomeScreen.loadData) {
                        HomeScreen.loadData();
                    }
                });
            }

            list.appendChild(item);
        });

        if (searchInput && searchInput.value) {
            this.filterTemplates(searchInput.value);
        } else if (emptySearch) {
            emptySearch.style.display = 'none';
        }
    },

    filterTemplates: function(query) {
        const items = document.querySelectorAll('.template-item');
        const emptySearch = document.getElementById('empty-search');
        let visibleCount = 0;
        const q = query.toLowerCase().trim();

        items.forEach(item => {
            const title = (item.getAttribute('data-title') || '').toLowerCase();
            if (title.includes(q)) {
                item.classList.remove('hidden');
                visibleCount++;
            } else {
                item.classList.add('hidden');
            }
        });

        if (emptySearch) {
            emptySearch.style.display = visibleCount === 0 ? 'block' : 'none';
        }
    },

    init: function() {
        const searchInput = document.getElementById('search-input');
        const addBtn = document.getElementById('templates-add-btn');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterTemplates(e.target.value);
            });
        }

        if (addBtn) {
            addBtn.addEventListener('click', () => {
                App.openCreateTemplateModal();
            });
        }

        this.loadTemplates();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    TemplatesScreen.init();
});
