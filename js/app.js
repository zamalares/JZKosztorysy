import {
  getGitHubConfig,
  saveGitHubConfig,
  fetchDatabaseFromGitHub,
  pushDatabaseToGitHub
} from './github-sync.js';
import { initPriceListModule, DEFAULT_PRICE_LIST } from './price-list.js';
import { initEstimateEditorModule, formatPLN } from './estimate-editor.js';
import { initArchiveModule, purgeExpiredTrash } from './archive.js';
import { generateEstimatePdf } from './pdf-generator.js';

const LOCAL_CACHE_KEY = 'jz_kosztorysy_db_cache_v1';
const PRICELIST_AUTOSAVE_DELAY_MS = 7000;  // ~7 s dla Cennika
const ARCHIVE_AUTOSAVE_DELAY_MS = 15000;   // ~15 s dla Archiwum / Kosza

let dbState = {
  meta: {
    version: 1,
    updatedAt: new Date().toISOString()
  },
  priceList: structuredClone(DEFAULT_PRICE_LIST),
  estimates: [],
  trash: []
};

let currentFileSha = null;
let autoSaveTimer = null;
let isSaving = false;
let hasUnsavedChanges = false;

// Elementy UI
const syncBadge = document.getElementById('sync-status');
const syncText = document.getElementById('sync-text');
const modal = document.getElementById('github-modal');
const settingsForm = document.getElementById('github-settings-form');

const previewModal = document.getElementById('preview-modal');
const previewTitle = document.getElementById('preview-title');
const previewBody = document.getElementById('preview-body');

function setSyncStatus(mode, text) {
  syncBadge.className = `sync-badge sync-${mode}`;
  syncText.textContent = text;
}

function saveLocalCache() {
  dbState.meta.updatedAt = new Date().toISOString();
  localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(dbState));
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.priceList)) {
        dbState = {
          meta: parsed.meta || { version: 1, updatedAt: new Date().toISOString() },
          priceList: parsed.priceList,
          estimates: Array.isArray(parsed.estimates) ? parsed.estimates : [],
          trash: Array.isArray(parsed.trash) ? parsed.trash : []
        };
      }
    }
  } catch (err) {
    console.warn('Błąd odczytu pamięci lokalnej:', err);
  }
}

async function syncNow(commitMessage = 'Aktualizacja bazy kosztorysów') {
  const config = getGitHubConfig();
  if (!config || !config.token || !config.repo) {
    setSyncStatus('idle', 'Zapisano lokalnie (brak tokenu GitHub)');
    return;
  }

  if (isSaving) return;
  isSaving = true;
  clearTimeout(autoSaveTimer);
  setSyncStatus('saving', 'Zapisywanie na GitHub...');

  try {
    dbState.meta.updatedAt = new Date().toISOString();
    const newSha = await pushDatabaseToGitHub(config, dbState, currentFileSha, commitMessage);
    if (newSha) currentFileSha = newSha;
    hasUnsavedChanges = false;
    saveLocalCache();
    setSyncStatus(
      'ok',
      `Zsynchronizowano (${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`
    );
  } catch (err) {
    console.error(err);
    setSyncStatus('error', `Błąd zapisu: ${err.message}`);
  } finally {
    isSaving = false;
  }
}

function scheduleAutoSave(delayMs, commitMessage) {
  hasUnsavedChanges = true;
  saveLocalCache();

  const config = getGitHubConfig();
  if (!config || !config.token) {
    setSyncStatus('idle', 'Zapisano lokalnie (brak tokenu GitHub)');
    return;
  }

  const sec = Math.round(delayMs / 1000);
  setSyncStatus('dirty', `Niezapisane zmiany (auto-zapis za ~${sec}s)...`);
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    syncNow(commitMessage);
  }, delayMs);
}

function upsertEstimateInState(estimate) {
  const idx = dbState.estimates.findIndex(e => e.id === estimate.id);
  if (idx >= 0) {
    dbState.estimates[idx] = estimate;
  } else {
    dbState.estimates.unshift(estimate);
  }
  saveLocalCache();
}

function openPreviewModal(est) {
  previewTitle.textContent = est.title ? `Podgląd: ${est.title}` : 'Podgląd kosztorysu';
  const rowsHtml = (est.items || [])
    .map((it) => {
      if (it.type === 'separator') {
        return `<div class="preview-sep">— SEPARATOR ${it.label ? `(${escapeText(it.label)})` : ''} —</div>`;
      }
      if (it.type === 'subtotal') {
        return `<div class="preview-sub"><strong>${escapeText(it.label || 'Suma częściowa')}</strong></div>`;
      }
      const lineSum = (Number(it.qty) || 0) * (Number(it.price) || 0);
      return `
        <div class="preview-row">
          <div>
            <strong>${escapeText(it.name || 'Pozycja bez nazwy')}</strong>
            <div class="muted small">${Number(it.qty) || 0} ${escapeText(it.unit || '')} × ${formatPLN(Number(it.price) || 0)}</div>
            ${it.note ? `<div class="preview-note">↳ ${escapeText(it.note)}</div>` : ''}
          </div>
          <strong>${formatPLN(lineSum)}</strong>
        </div>
      `;
    })
    .join('');

  previewBody.innerHTML = `
    <div class="muted small">
      <strong>Dla:</strong> ${escapeText(est.client || '—')} |
      <strong>Ważny:</strong> ${escapeText(est.validFrom || '—')} – ${escapeText(est.validTo || '—')}
    </div>
    <div class="preview-list">${rowsHtml || '<p class="muted">Brak pozycji.</p>'}</div>
    <div class="preview-total">
      <span>Suma końcowa:</span>
      <strong>${formatPLN(est.summary?.total ?? 0)}</strong>
    </div>
    <div style="margin-top: 10px; text-align: right;">
      <button type="button" id="btn-preview-download-pdf" class="btn btn-primary btn-sm">📄 Pobierz PDF</button>
    </div>
  `;

  previewBody.querySelector('#btn-preview-download-pdf').addEventListener('click', async () => {
    try {
      await generateEstimatePdf(est);
    } catch (err) {
      console.error(err);
      alert(`Błąd generowania PDF: ${err.message}`);
    }
  });

  previewModal.classList.remove('hidden');
}

function closePreviewModal() {
  previewModal.classList.add('hidden');
}

document.querySelectorAll('[data-close-preview]').forEach((el) => {
  el.addEventListener('click', closePreviewModal);
});

async function switchTab(tabName) {
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('active', v.id === `view-${tabName}`);
  });

  if (tabName === 'editor') {
    estimateEditorModule.render();
  } else if (tabName === 'pricelist') {
    priceListModule.render();
  } else if (tabName === 'archive') {
    await refreshFromGitHubSilent();
    archiveModule.render();
  }
}

// Moduł 1: Cennik (auto-zapis co ~7s)
const priceListModule = initPriceListModule({
  getState: () => dbState,
  onPriceListChanged: () => {
    scheduleAutoSave(PRICELIST_AUTOSAVE_DELAY_MS, 'Aktualizacja cennika');
  }
});

// Moduł 2: Nowy kosztorys / Edytor (zapis na GitHub dopiero przy Zapisz lub Generuj PDF)
const estimateEditorModule = initEstimateEditorModule({
  getState: () => dbState,
  onSaveDraft: async (draftEstimate) => {
    upsertEstimateInState(draftEstimate);
    await syncNow(`Zapis szkicu kosztorysu: ${draftEstimate.title || draftEstimate.client || draftEstimate.id}`);
    alert(`Zapisano szkic roboczy (${formatPLN(draftEstimate.summary?.total || 0)}).`);
  },
  onGeneratePdf: async (finalEstimate) => {
    upsertEstimateInState(finalEstimate);
    await syncNow(`Domknięcie kosztorysu (PDF): ${finalEstimate.title || finalEstimate.client || finalEstimate.id}`);
    try {
      await generateEstimatePdf(finalEstimate);
    } catch (err) {
      console.error(err);
      alert(`Kosztorys zapisany, ale wystąpił błąd przy generowaniu pliku PDF: ${err.message}`);
    }
  }
});

// Moduł 3: Archiwum + Kosz 30 dni + backup JSON (auto-zapis co ~15s)
const archiveModule = initArchiveModule({
  getState: () => dbState,
  onArchiveChanged: (commitMsg) => {
    scheduleAutoSave(ARCHIVE_AUTOSAVE_DELAY_MS, commitMsg);
  },
  onEditEstimate: (est) => {
    estimateEditorModule.loadEstimate(est, 'edit');
    switchTab('editor');
  },
  onUseAsTemplate: (est) => {
    estimateEditorModule.loadEstimate(est, 'template');
    switchTab('editor');
  },
  onPreviewEstimate: (est) => {
    openPreviewModal(est);
  },
  onImportDatabase: async (importedData) => {
    dbState = {
      meta: importedData.meta || { version: 1, updatedAt: new Date().toISOString() },
      priceList: Array.isArray(importedData.priceList) ? importedData.priceList : structuredClone(DEFAULT_PRICE_LIST),
      estimates: Array.isArray(importedData.estimates) ? importedData.estimates : [],
      trash: Array.isArray(importedData.trash) ? importedData.trash : []
    };
    purgeExpiredTrash(dbState);
    saveLocalCache();
    priceListModule.render();
    estimateEditorModule.render();
    await syncNow('Import kopii zapasowej JSON');
  }
});

// Nawigacja między podstronami
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

// Modal ustawień GitHub
function openSettingsModal() {
  const cfg = getGitHubConfig();
  if (cfg) {
    document.getElementById('gh-repo').value = cfg.repo || '';
    document.getElementById('gh-branch').value = cfg.branch || 'main';
    document.getElementById('gh-path').value = cfg.path || 'data/kosztorysy-db.json';
    document.getElementById('gh-token').value = cfg.token || '';
  }
  modal.classList.remove('hidden');
}

function closeSettingsModal() {
  modal.classList.add('hidden');
}

document.getElementById('btn-open-settings').addEventListener('click', openSettingsModal);
document.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', closeSettingsModal));

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const config = {
    repo: document.getElementById('gh-repo').value.trim(),
    branch: document.getElementById('gh-branch').value.trim() || 'main',
    path: document.getElementById('gh-path').value.trim() || 'data/kosztorysy-db.json',
    token: document.getElementById('gh-token').value.trim()
  };
  saveGitHubConfig(config);
  closeSettingsModal();
  await initialLoadFromGitHub();
});

document.getElementById('btn-sync-now').addEventListener('click', () => {
  syncNow('Ręczna synchronizacja z aplikacji');
});

window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

async function refreshFromGitHubSilent() {
  const config = getGitHubConfig();
  if (!config || !config.token || !config.repo || hasUnsavedChanges || isSaving) return;

  try {
    const result = await fetchDatabaseFromGitHub(config);
    if (result.exists && result.data) {
      currentFileSha = result.sha;
      dbState = {
        meta: result.data.meta || { version: 1, updatedAt: new Date().toISOString() },
        priceList: Array.isArray(result.data.priceList) ? result.data.priceList : structuredClone(DEFAULT_PRICE_LIST),
        estimates: Array.isArray(result.data.estimates) ? result.data.estimates : [],
        trash: Array.isArray(result.data.trash) ? result.data.trash : []
      };
      purgeExpiredTrash(dbState);
      saveLocalCache();
    }
  } catch (err) {
    console.warn('Ciche odświeżenie z GitHub nie powiodło się:', err);
  }
}

async function initialLoadFromGitHub() {
  loadLocalCache();
  purgeExpiredTrash(dbState);
  priceListModule.render();
  estimateEditorModule.render();
  archiveModule.render();

  const config = getGitHubConfig();
  if (!config || !config.token || !config.repo) {
    setSyncStatus('idle', 'Brak konfiguracji GitHub');
    return;
  }

  setSyncStatus('saving', 'Pobieranie danych z GitHub...');
  try {
    const result = await fetchDatabaseFromGitHub(config);
    if (result.exists && result.data) {
      currentFileSha = result.sha;
      dbState = {
        meta: result.data.meta || { version: 1, updatedAt: new Date().toISOString() },
        priceList: Array.isArray(result.data.priceList) ? result.data.priceList : structuredClone(DEFAULT_PRICE_LIST),
        estimates: Array.isArray(result.data.estimates) ? result.data.estimates : [],
        trash: Array.isArray(result.data.trash) ? result.data.trash : []
      };
      const purged = purgeExpiredTrash(dbState);
      saveLocalCache();
      priceListModule.render();
      estimateEditorModule.render();
      archiveModule.render();
      setSyncStatus('ok', 'Połączono z GitHub');
      if (purged) {
        scheduleAutoSave(ARCHIVE_AUTOSAVE_DELAY_MS, 'Czyszczenie wpisów po 30 dniach w koszu');
      }
    } else {
      currentFileSha = null;
      await syncNow('Inicjalizacja bazy kosztorysów');
    }
  } catch (err) {
    console.error(err);
    setSyncStatus('error', `Błąd połączenia: ${err.message}`);
  }
}

function escapeText(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initialLoadFromGitHub();
