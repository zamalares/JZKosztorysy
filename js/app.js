import {
  getGitHubConfig,
  saveGitHubConfig,
  fetchDatabaseFromGitHub,
  pushDatabaseToGitHub
} from './github-sync.js';
import { initPriceListModule, DEFAULT_PRICE_LIST } from './price-list.js';
import { initEstimateEditorModule, formatPLN } from './estimate-editor.js';

const LOCAL_CACHE_KEY = 'jz_kosztorysy_db_cache_v1';
const PRICELIST_AUTOSAVE_DELAY_MS = 7000; // 7 sekund opóźnienia dla Cennika

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

  setSyncStatus('dirty', 'Niezapisane zmiany (auto-zapis wkrótce)...');
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

function switchTab(tabName) {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${tabName}`);
  });

  if (tabName === 'editor') {
    estimateEditorModule.render();
  } else if (tabName === 'pricelist') {
    priceListModule.render();
  }
}

// Moduł 1: Cennik (auto-zapis z opóźnieniem ~7s)
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
    alert(
      `Kosztorys domknięty i zapisany w archiwum (${formatPLN(finalEstimate.summary?.total || 0)}). W Kroku 4 podepniemy tutaj właściwy eksport pliku PDF.`
    );
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

async function initialLoadFromGitHub() {
  loadLocalCache();
  priceListModule.render();
  estimateEditorModule.render();

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
      saveLocalCache();
      priceListModule.render();
      estimateEditorModule.render();
      setSyncStatus('ok', 'Połączono z GitHub');
    } else {
      currentFileSha = null;
      await syncNow('Inicjalizacja bazy kosztorysów');
    }
  } catch (err) {
    console.error(err);
    setSyncStatus('error', `Błąd połączenia: ${err.message}`);
  }
}

initialLoadFromGitHub();
