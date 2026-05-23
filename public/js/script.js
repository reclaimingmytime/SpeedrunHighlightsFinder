document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleOpponentClips');
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      const value = toggle.getAttribute('data-value');
      document.cookie = `includeOpponent=${value}; path=/; max-age=31536000`;
      window.location.reload();
    });
  }

  // --- Search history (client-side using localStorage) ---
  const STORAGE_KEY = 'mcsr_search_history';
  const MAX_HISTORY = 100;

  function safeLocalStorageAvailable() {
    try {
      const test = '__mcsr_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadHistory() {
    if (!safeLocalStorageAvailable()) return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveHistory(obj) {
    if (!safeLocalStorageAvailable()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {}
  }

  function normalizeKey(user) {
    return (user || '').trim().toLowerCase();
  }

  function recordSearch(user) {
    if (!user || user.trim() === '') return;

    const key = normalizeKey(user);
    const h = loadHistory();
    const now = new Date().toISOString();

    if (!h[key]) {
      h[key] = { count: 0, last: now, user: user || '' };
    }

    h[key].count = (h[key].count || 0) + 1;
    h[key].last = now;

    const entries = Object.entries(h);
    if (entries.length > MAX_HISTORY) {
      entries.sort((a, b) => new Date(a[1].last) - new Date(b[1].last));
      const toKeep = entries.slice(entries.length - MAX_HISTORY);
      saveHistory(Object.fromEntries(toKeep));
    } else {
      saveHistory(h);
    }
  }

  function clearHistory() {
    if (!safeLocalStorageAvailable()) return;
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
  }

  function buildUrl(user) {
    try {
      const params = new URLSearchParams();
      if (user && user.trim() !== '') params.set('user', user);
      return (
        window.location.pathname +
        (params.toString() ? '?' + params.toString() : '')
      );
    } catch {
      return window.location.pathname;
    }
  }

  function renderHistory() {
    const list = document.getElementById('historyList');
    const emptyMsg = document.getElementById('historyEmptyMessage');

    if (!list || !emptyMsg) return;

    const h = loadHistory();
    const entries = Object.entries(h).map(([k, v]) => ({ key: k, ...v }));

    if (entries.length === 0) {
      list.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }

    emptyMsg.style.display = 'none';
    entries.sort((a, b) => new Date(b.last) - new Date(a.last));
    list.innerHTML = '';

    for (const e of entries) {
      const p = document.createElement('p');

      const user = e.user || '(all)';
      const url = buildUrl(e.user);

      // avatar (NOT clickable)
      const img = document.createElement('img');
      img.src =
        'https://mineskin.eu/avatar/' + encodeURIComponent(user) + '/8.svg';
      img.alt = 'Player Avatar';
      img.style.height = '18px';
      img.style.display = 'inline';
      img.style.marginBottom = '0';

      // text link (ONLY clickable part)
      const textA = document.createElement('a');
      textA.href = url;
      textA.textContent = `${user} — ${e.count} time${e.count === 1 ? '' : 's'} — last: ${new Date(e.last).toLocaleString()}`;

      // delete button
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.style.marginLeft = '6px';

      delBtn.addEventListener('click', () => {
        const h2 = loadHistory();
        delete h2[e.key];
        saveHistory(h2);
        renderHistory();
      });

      // assemble
      p.appendChild(img);
      p.appendChild(document.createTextNode(' '));
      p.appendChild(textA);
      p.appendChild(delBtn);

      list.appendChild(p);
    }
  }

  // view switching
  const latestBtn = document.getElementById('viewLatestBtn');
  const historyBtn = document.getElementById('viewHistoryBtn');
  const latestContainer = document.getElementById('latestMatchesContainer');
  const historyPanel = document.getElementById('searchHistoryPanel');
  const searchForm = document.getElementById('searchForm');

  function updateUrlViewParam(mode) {
    try {
      const url = new URL(window.location.href);

      if (mode === 'history') {
        url.searchParams.set('view', 'history');
      } else {
        url.searchParams.delete('view');
      }

      window.history.replaceState({}, '', url.toString());
    } catch {}
  }

  function switchView(mode) {
    if (mode === 'history') {
      if (latestContainer) latestContainer.style.display = 'none';
      if (historyPanel) historyPanel.style.display = '';
      if (searchForm) searchForm.style.display = 'none';
      renderHistory();
      updateUrlViewParam('history');

      if (historyBtn) historyBtn.classList.add('nav-inactive');
      if (latestBtn) latestBtn.classList.remove('nav-inactive');
    } else {
      if (latestContainer) latestContainer.style.display = '';
      if (historyPanel) historyPanel.style.display = 'none';
      if (searchForm) searchForm.style.display = '';
      updateUrlViewParam('latest');

      if (latestBtn) latestBtn.classList.add('nav-inactive');
      if (historyBtn) historyBtn.classList.remove('nav-inactive');
    }
  }

  if (latestBtn)
    latestBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('latest');
    });

  if (historyBtn)
    historyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('history');
    });

  // initial view logic (FIXED)
  let initialMode;

  try {
    const params = new URLSearchParams(window.location.search);
    const userParam = params.get('user');
    const viewParam = params.get('view');

    if (viewParam === 'history') {
      initialMode = 'history';
    } else {
      initialMode = 'latest';

      if (userParam && userParam.trim() !== '') {
        recordSearch(userParam);
      }
    }
  } catch {
    initialMode = 'latest';
  }

  switchView(initialMode);

  const clearBtn = document.getElementById('clearHistory');
  if (clearBtn)
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear all search history?')) clearHistory();
    });
});
