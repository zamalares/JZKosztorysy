import { formatPLN } from './estimate-editor.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function purgeExpiredTrash(state) {
  if (!Array.isArray(state.trash)) {
    state.trash = [];
    return false;
  }
  const now = Date.now();
  const before = state.trash.length;
  state.trash = state.trash.filter((item) => {
    const deletedAtMs = Date.parse(item.deletedAt || '');
    if (Number.isNaN(deletedAtMs)) return true;
    return now - deletedAtMs < THIRTY_DAYS_MS;
  });
  return state.trash.length !== before;
}

function daysRemainingInTrash(deletedAt) {
  const deletedMs = Date.parse(deletedAt || '');
  if (Number.isNaN(deletedMs)) return 30;
  const elapsed = Date.now() - deletedMs;
  const remaining = Math.ceil((THIRTY_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}

function getEstimateDisplayTotal(est) {
  if (est?.summary && typeof est.summary.total === 'number') {
    return est.summary.total;
  }
  const items = Array.isArray(est?.items) ? est.items : [];
  const sum = items.reduce((acc, it) => {
    if (it.type === 'service' || it.type === 'custom') {
      return acc + (Number(it.qty) || 0) * (Number(it.price) || 0);
    }
    return acc;
  }, 0);
  return sum;
}

export function initArchiveModule({
  getState,
  onArchiveChanged,
  onEditEstimate,
  onUseAsTemplate,
  onPreviewEstimate,
  onImportDatabase
}) {
  const listContainer = document.getElementById('archive-list');
  const searchInput = document.getElementById('archive-search');
  const statusFilterSelect = document.getElementById('archive-status-filter');
  const countEl = document.getElementById('archive-count');

  const tabCurrentBtn = document.getElementById('arch-tab-current');
  const tabArchivedBtn = document.getElementById('arch-tab-archived');
  const tabTrashBtn = document.getElementById('arch-tab-trash');

  const exportBtn = document.getElementById('btn-export-json');
  const importBtn = document.getElementById('btn-import-json');
  const importFileInput = document.getElementById('archive-import-file');

  let activeSubTab = 'current'; // 'current' | 'archived' | 'trash'

  function updateSubTabButtons() {
    const state = getState();
    const estimates = state.estimates || [];
    const trash = state.trash || [];

    const currentCount = estimates.filter(e => !e.archived).length;
    const archivedCount = estimates.filter(e => Boolean(e.archived)).length;
    const trashCount = trash.length;

    tabCurrentBtn.textContent = `Bieżące (${currentCount})`;
    tabArchivedBtn.textContent = `Kosztorysy archiwalne (${archivedCount})`;
    tabTrashBtn.textContent = `Kosz 30 dni (${trashCount})`;

    tabCurrentBtn.classList.toggle('active', activeSubTab === 'current');
    tabArchivedBtn.classList.toggle('active', activeSubTab === 'archived');
    tabTrashBtn.classList.toggle('active', activeSubTab === 'trash');
  }

  function render() {
    const state = getState();
    const removedExpired = purgeExpiredTrash(state);
    if (removedExpired) {
      onArchiveChanged('Automatyczne czyszczenie kosza po 30 dniach');
    }

    updateSubTabButtons();

    const query = (searchInput.value || '').trim().toLowerCase();
    const statusFilter = statusFilterSelect.value;

    const sourceList = activeSubTab === 'trash'
      ? (state.trash || []).map(item => ({ item, isTrash: true }))
      : (state.estimates || [])
          .filter(est => (activeSubTab === 'archived' ? Boolean(est.archived) : !est.archived))
          .map(item => ({ item, isTrash: false }));

    const filtered = sourceList.filter(({ item, isTrash }) => {
      if (!isTrash && statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!query) return true;
      const title = (item.title || '').toLowerCase();
      const client = (item.client || '').toLowerCase();
      return title.includes(query) || client.includes(query);
    });

    countEl.textContent = `Wyświetlono: ${filtered.length} z ${sourceList.length}`;
    listContainer.innerHTML = '';

    if (!filtered.length) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'card empty-box';
      emptyBox.textContent =
        activeSubTab === 'trash'
          ? 'Kosz jest pusty. Usunięte kosztorysy trafiają tu na 30 dni.'
          : 'Brak kosztorysów spełniających kryteria w tym widoku.';
      listContainer.appendChild(emptyBox);
      return;
    }

    filtered.forEach(({ item, isTrash }) => {
      const card = document.createElement('div');
      card.className = 'card archive-item';

      const statusBadge =
        item.status === 'final'
          ? '<span class="status-pill status-final">WYGENEROWANY PDF</span>'
          : '<span class="status-pill status-draft">SZKIC ROBOCZY</span>';

      const dateRange =
        item.validFrom || item.validTo
          ? `Ważny: ${item.validFrom || '—'} – ${item.validTo || '—'}`
          : '';

      const updatedStr = item.updatedAt
        ? `Zmiana: ${new Date(item.updatedAt).toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}`
        : '';

      const itemsCount = Array.isArray(item.items)
        ? item.items.filter(i => i.type === 'service' || i.type === 'custom').length
        : 0;

      const totalFormatted = formatPLN(getEstimateDisplayTotal(item));

      let actionsHtml = '';
      if (isTrash) {
        const leftDays = daysRemainingInTrash(item.deletedAt);
        actionsHtml = `
          <span class="trash-days">Usunięcie za ${leftDays} ${leftDays === 1 ? 'dzień' : 'dni'}</span>
          <button type="button" class="btn btn-secondary btn-sm js-restore">↩ Przywróć</button>
          <button type="button" class="btn btn-danger btn-sm js-delete-permanent">Usuń teraz</button>
        `;
      } else {
        actionsHtml = `
          <button type="button" class="btn btn-secondary btn-sm js-preview">Podgląd</button>
          <button type="button" class="btn btn-secondary btn-sm js-edit">✎ Edytuj</button>
          <button type="button" class="btn btn-secondary btn-sm js-template">⧉ Jako szablon</button>
          <button type="button" class="btn btn-secondary btn-sm js-toggle-archive">
            ${item.archived ? '↩ Do bieżących' : '📦 Do archiwalnych'}
          </button>
          <button type="button" class="btn btn-danger btn-sm js-move-trash" title="Przenieś do kosza (30 dni)">
            🗑 Kosz
          </button>
        `;
      }

      card.innerHTML = `
        <div class="archive-item-main">
          <div class="archive-item-top">
            <strong class="archive-title">${escapeHtml(item.title || 'Kosztorys bez nazwy')}</strong>
            ${statusBadge}
          </div>
          <div class="archive-meta muted small">
            <span><strong>Dla:</strong> ${escapeHtml(item.client || '—')}</span>
            <span>•</span>
            <span>Pozycji: ${itemsCount}</span>
            ${dateRange ? `<span>•</span><span>${escapeHtml(dateRange)}</span>` : ''}
            ${updatedStr ? `<span>•</span><span>${escapeHtml(updatedStr)}</span>` : ''}
          </div>
        </div>

        <div class="archive-item-right">
          <div class="archive-amount">${totalFormatted}</div>
          <div class="archive-actions">${actionsHtml}</div>
        </div>
      `;

      if (isTrash) {
        card.querySelector('.js-restore').addEventListener('click', () => {
          const restored = structuredClone(item);
          delete restored.deletedAt;
          restored.archived = Boolean(restored.archived);
          state.trash = (state.trash || []).filter(t => t.id !== item.id);
          state.estimates.unshift(restored);
          render();
          onArchiveChanged(`Przywrócenie kosztorysu z kosza: ${item.title || item.id}`);
        });

        card.querySelector('.js-delete-permanent').addEventListener('click', () => {
          if (!confirm(`Trwale usunąć kosztorys „${item.title || 'Bez nazwy'}”? Tej operacji nie można cofnąć.`)) {
            return;
          }
          state.trash = (state.trash || []).filter(t => t.id !== item.id);
          render();
          onArchiveChanged(`Trwałe usunięcie kosztorysu: ${item.title || item.id}`);
        });
      } else {
        card.querySelector('.js-preview').addEventListener('click', () => {
          onPreviewEstimate(item);
        });

        card.querySelector('.js-edit').addEventListener('click', () => {
          onEditEstimate(item);
        });

        card.querySelector('.js-template').addEventListener('click', () => {
          onUseAsTemplate(item);
        });

        card.querySelector('.js-toggle-archive').addEventListener('click', () => {
          item.archived = !Boolean(item.archived);
          item.updatedAt = new Date().toISOString();
          render();
          onArchiveChanged(
            item.archived
              ? `Przeniesienie do archiwalnych: ${item.title || item.id}`
              : `Przywrócenie do bieżących: ${item.title || item.id}`
          );
        });

        card.querySelector('.js-move-trash').addEventListener('click', () => {
          state.estimates = (state.estimates || []).filter(e => e.id !== item.id);
          const trashedItem = {
            ...structuredClone(item),
            deletedAt: new Date().toISOString()
          };
          state.trash = state.trash || [];
          state.trash.unshift(trashedItem);
          render();
          onArchiveChanged(`Przeniesienie kosztorysu do kosza (30 dni): ${item.title || item.id}`);
        });
      }

      listContainer.appendChild(card);
    });
  }

  tabCurrentBtn.addEventListener('click', () => {
    activeSubTab = 'current';
    render();
  });

  tabArchivedBtn.addEventListener('click', () => {
    activeSubTab = 'archived';
    render();
  });

  tabTrashBtn.addEventListener('click', () => {
    activeSubTab = 'trash';
    render();
  });

  searchInput.addEventListener('input', render);
  statusFilterSelect.addEventListener('change', render);

  // Eksport kopii zapasowej JSON
  exportBtn.addEventListener('click', () => {
    const state = getState();
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jz-kosztorysy-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // Import kopii zapasowej JSON
  importBtn.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.priceList)) {
        alert('Nieprawidłowy plik bazy JSON (brak tablicy priceList).');
        return;
      }
      if (!confirm('Wczytanie kopii JSON zastąpi bieżący stan cennika, kosztorysów i kosza. Kontynuować?')) {
        return;
      }
      await onImportDatabase(parsed);
      render();
    } catch (err) {
      console.error(err);
      alert(`Błąd odczytu pliku JSON: ${err.message}`);
    }
  });

  render();

  return { render };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
