import {
  getGitHubConfig,
  saveGitHubConfig,
  fetchDatabaseFromGitHub,
  pushDatabaseToGitHub
} from './github-sync.js';
import { initPriceListModule, DEFAULT_PRICE_LIST } from './price-list.js';

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
    setSyncStatus('ok', `Zsynchronizowano (${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`);
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

// Moduł Cennika
const priceListModule = initPriceListModule({
  getState: () => dbState,
  onPriceListChanged: () => {
    scheduleAutoSave(PRICELIST_AUTOSAVE_DELAY_MS, 'Aktualizacja cennika');
  }
});

// Nawigacja między 3 podstronami
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(`view-${target}`).classList.add('active');
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

// Ostrzeżenie przed zamknięciem karty, jeśli wisi niezapisana zmiana
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Inicjalizacja przy starcie strony
async function initialLoadFromGitHub() {
  loadLocalCache();
  priceListModule.render();

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
      setSyncStatus('ok', 'Połączono z GitHub');
    } else {
      // Plik jeszcze nie istnieje na GitHubie — zapisujemy bazę startową
      currentFileSha = null;
      await syncNow('Inicjalizacja bazy kosztorysów');
    }
  } catch (err) {
    console.error(err);
    setSyncStatus('error', `Błąd połączenia: ${err.message}`);
  }
}

initialLoadFromGitHub();
