const CONFIG_STORAGE_KEY = 'jz_kosztorysy_gh_config_v1';

export function getGitHubConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGitHubConfig(config) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function encodeBase64Unicode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64Unicode(base64) {
  const clean = base64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchDatabaseFromGitHub(config) {
  const { repo, branch, path, token } = config;
  const url = `https://api.github.com/repos/${repo.trim()}/contents/${path.trim()}?ref=${encodeURIComponent(branch.trim())}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    cache: 'no-store'
  });

  if (res.status === 404) {
    // Plik jeszcze nie istnieje w repozytorium — utworzymy go przy pierwszym zapisie
    return { exists: false, sha: null, data: null };
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || `Błąd GitHub API (${res.status})`);
  }

  const json = await res.json();
  const decodedText = decodeBase64Unicode(json.content);
  return {
    exists: true,
    sha: json.sha,
    data: JSON.parse(decodedText)
  };
}

export async function pushDatabaseToGitHub(config, dbObject, currentSha, commitMessage = 'Aktualizacja bazy kosztorysów') {
  const { repo, branch, path, token } = config;
  const url = `https://api.github.com/repos/${repo.trim()}/contents/${path.trim()}`;

  const payload = {
    message: commitMessage,
    content: encodeBase64Unicode(JSON.stringify(dbObject, null, 2)),
    branch: branch.trim()
  };

  if (currentSha) {
    payload.sha = currentSha;
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || `Nie udało się zapisać do GitHub (${res.status})`);
  }

  const result = await res.json();
  return result.content?.sha || null;
}
