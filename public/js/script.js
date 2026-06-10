//todo future features for "latest from history" view:
// - make view similar to highlights view (space between player head and name)
// - pagination and limit (do not fetch more players after limit is reached, show "load more" button, and then dont fetch the ones you already fetched but dont display them either)
// - also add "include opponent" to "latest from history" (with similar border).

document.addEventListener('DOMContentLoaded', () => {
  // --- Toggle opponent clips ---
  const toggle = document.getElementById('toggleOpponentClips');
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      const value = toggle.getAttribute('data-value');
      document.cookie = `includeOpponent=${value}; path=/; max-age=31536000`;
      window.location.reload();
    });
  }

  // --- Helpers for fetching latest matches from search history ---
  function getIncludeOpponentFromCookie() {
    try {
      return document.cookie
        .split(';')
        .map((c) => c.trim())
        .includes('includeOpponent=true');
    } catch {
      return false;
    }
  }

  function renderLatestMatches(vods) {
    const container = document.getElementById('latestMatchesContainer');
    if (!container) return;

    container.innerHTML = '';

    if (!vods || vods.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No highlights found.';
      container.appendChild(p);
      return;
    }

    for (const vod of vods) {
      const p = document.createElement('p');
      const avatarAnchor = document.createElement('a');
      avatarAnchor.href = buildUrl(vod.vodNickname);
      avatarAnchor.title = 'See all highlights by player';

      const img = document.createElement('img');
      img.src = 'https://mineskin.eu/avatar/' + encodeURIComponent(vod.vodNickname) + '/8.svg';
      img.alt = 'Player Avatar';
      img.style.height = '18px';
      img.style.display = 'inline';
      img.style.marginBottom = '0';

      avatarAnchor.appendChild(img);

      const link = document.createElement('a');
      link.href = vod.vodLink;
      link.rel = 'noreferrer';
      link.target = '_blank';
      link.textContent = `${vod.vodNickname} at ${vod.vodTime}`;

      p.appendChild(avatarAnchor);
      p.appendChild(link);

      container.appendChild(p);
    }
  }

  async function fetchlatestFromHistory() {
    const container = document.getElementById('latestMatchesContainer');
    if (!container) return;

    container.innerHTML = '';
    const loading = document.createElement('p');
    loading.textContent = 'Loading latest matches from history...';
    container.appendChild(loading);

    const history = loadHistory();
    const entries = Object.entries(history).map(([key, value]) => ({ key, ...value }));

    if (entries.length === 0) {
      renderLatestMatches([]);
      return;
    }

    // season from input if present
    let season;
    try {
      const seasonInput = document.getElementById('season');
      if (seasonInput && seasonInput.value && seasonInput.value.trim() !== '') {
        season = Number(seasonInput.value);
      }
    } catch {}

    const includeOpponent = getIncludeOpponentFromCookie();

    const allVods = [];
    const seenLinks = new Set();

    // Fetch each user's latest vods sequentially to avoid hammering the API
    for (const entry of entries) {
      if (!entry.user) continue;
      try {
        const params = new URLSearchParams();
        params.set('user', entry.user);
        if (season !== undefined) params.set('season', String(season));
        if (includeOpponent) params.set('includeOpponent', 'true');

        const res = await fetch('/api/latest?' + params.toString());
        if (!res.ok) continue;
        const json = await res.json();
        const vods = json.vods || [];

        for (const vod of vods) {
          if (!seenLinks.has(vod.vodLink)) {
            seenLinks.add(vod.vodLink);
            allVods.push(vod);
          }
        }
      } catch (err) {
        // ignore individual user errors and continue
      }
    }

    // Show results
    if (allVods.length === 0) {
      renderLatestMatches([]);
      return;
    }

    // Sort by event time (newest first) — server provides `eventUnix` (seconds since epoch)
    allVods.sort((a, b) => {
      const ta = typeof a.eventUnix === 'number' ? a.eventUnix : 0;
      const tb = typeof b.eventUnix === 'number' ? b.eventUnix : 0;
      return tb - ta;
    });

    renderLatestMatches(allVods);
  }

  // --- Search history (client-side using localStorage) ---
  const STORAGE_KEY = 'mcsr_search_history';
  const MAX_HISTORY = 100;

  function loadHistory() {
    if (!localStorage) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {}
  }

  function normalizeKey(user) {
    return (user || '').trim().toLowerCase();
  }

  function hasErrorMessage() {
    const latestContainer = document.getElementById('latestMatchesContainer');

    if (!latestContainer) return false;

    const text = latestContainer.textContent || '';

    return (
      text.toLowerCase().includes('does not exist') ||
      text.toLowerCase().includes('not found') ||
      text.toLowerCase().includes('error')
    );
  }

  function recordSearch(user) {
    if (!user || user.trim() === '') return;

    const key = normalizeKey(user);
    const history = loadHistory();
    const now = new Date().toISOString();

    if (!history[key]) {
      history[key] = {
        count: 0,
        last: now,
        user,
      };
    }

    history[key].count += 1;
    history[key].last = now;

    const entries = Object.entries(history);

    if (entries.length > MAX_HISTORY) {
      entries.sort((a, b) => new Date(a[1].last) - new Date(b[1].last));

      const trimmedEntries = entries.slice(entries.length - MAX_HISTORY);

      saveHistory(Object.fromEntries(trimmedEntries));
    } else {
      saveHistory(history);
    }
  }

  function clearHistory() {
    if (!localStorage) return;
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
  }

  function buildUrl(user) {
    try {
      const params = new URLSearchParams();

      if (user && user.trim() !== '') {
        params.set('user', user);
      }

      return window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    } catch {
      return window.location.pathname;
    }
  }

  function renderHistory() {
    const list = document.getElementById('historyList');

    const emptyMessage = document.getElementById('historyEmptyMessage');

    if (!list || !emptyMessage) return;

    const history = loadHistory();

    const entries = Object.entries(history).map(([key, value]) => ({
      key,
      ...value,
    }));

    if (entries.length === 0) {
      list.innerHTML = '';

      emptyMessage.style.display = '';

      return;
    }

    emptyMessage.style.display = 'none';

    entries.sort((a, b) => new Date(b.last) - new Date(a.last));

    list.innerHTML = '';

    for (const entry of entries) {
      const p = document.createElement('p');

      const displayUser = entry.user || '(all)';
      const url = buildUrl(entry.user);

      // player link
      const playerLink = document.createElement('a');

      playerLink.href = url;
      playerLink.title = 'See all highlights by player';

      // avatar image
      const img = document.createElement('img');

      if (entry.user) {
        img.src = 'https://mineskin.eu/avatar/' + encodeURIComponent(entry.user) + '/8.svg';
      }

      img.alt = 'Player Avatar';
      img.style.height = '18px';
      img.style.display = 'inline';
      img.style.marginBottom = '0';

      // link text
      const linkText = document.createTextNode(
        ' ' +
          `${displayUser} — ` +
          `${entry.count} time${entry.count === 1 ? '' : 's'} ` +
          `— last: ${new Date(entry.last).toLocaleString()}`,
      );

      playerLink.appendChild(img);
      playerLink.appendChild(linkText);

      // delete button
      const deleteButton = document.createElement('button');

      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.style.marginLeft = '6px';

      deleteButton.addEventListener('click', () => {
        const updatedHistory = loadHistory();

        delete updatedHistory[entry.key];

        saveHistory(updatedHistory);

        renderHistory();
      });

      // assemble
      p.appendChild(playerLink);
      p.appendChild(deleteButton);

      list.appendChild(p);
    }
  }

  // --- View switching ---
  const latestButton = document.getElementById('viewLatestBtn');
  const latestFromHistoryButton = document.getElementById('viewlatestFromHistoryBtn');

  const historyButton = document.getElementById('viewHistoryBtn');

  const latestContainer = document.getElementById('latestMatchesContainer');
  const historyPanel = document.getElementById('searchHistoryPanel');
  const searchForm = document.getElementById('searchForm');

  function updateUrlViewParam(mode) {
    try {
      const url = new URL(window.location.href);

      // support custom view modes. 'latest' means no view param, 'history' is explicit,
      // other modes will be stored in the 'view' query param (e.g. 'latestFromHistory')
      if (mode === 'history') {
        url.searchParams.set('view', 'history');
      } else if (mode === 'latest') {
        url.searchParams.delete('view');
      } else {
        url.searchParams.set('view', mode);
      }

      window.history.replaceState({}, '', url.toString());
    } catch {}
  }

  function switchView(mode) {
    if (mode === 'history') {
      if (latestContainer) {
        latestContainer.style.display = 'none';
      }

      if (historyPanel) {
        historyPanel.style.display = '';
      }

      if (searchForm) {
        searchForm.style.display = 'none';
      }

      renderHistory();
      updateUrlViewParam('history');

      if (historyButton) {
        historyButton.classList.add('nav-inactive');
      }

      if (latestButton) {
        latestButton.classList.remove('nav-inactive');
      }

      if (latestFromHistoryButton) {
        latestFromHistoryButton.classList.remove('nav-inactive');
      }
    } else if (mode === 'latestFromHistory') {
      // show latest container but load aggregated results from local history
      if (latestContainer) {
        latestContainer.style.display = '';
      }

      if (historyPanel) {
        historyPanel.style.display = 'none';
      }

      if (searchForm) {
        searchForm.style.display = '';
      }

      updateUrlViewParam(mode);

      if (latestFromHistoryButton) {
        latestFromHistoryButton.classList.add('nav-inactive');
      }

      if (latestButton) {
        latestButton.classList.remove('nav-inactive');
      }

      if (historyButton) {
        historyButton.classList.remove('nav-inactive');
      }

      // trigger the fetch for aggregated results
      fetchlatestFromHistory();
    } else {
      if (latestContainer) {
        latestContainer.style.display = '';
      }

      if (historyPanel) {
        historyPanel.style.display = 'none';
      }

      if (searchForm) {
        searchForm.style.display = '';
      }

      updateUrlViewParam(mode);

      if (latestButton) {
        latestButton.classList.add('nav-inactive');
      }

      if (historyButton) {
        historyButton.classList.remove('nav-inactive');
      }

      if (latestFromHistoryButton) {
        latestFromHistoryButton.classList.remove('nav-inactive');
      }
    }
  }

  if (latestButton) {
    // clicking Matches should redirect to the canonical latest matches page (reload)
    latestButton.addEventListener('click', (e) => {
      e.preventDefault();
      // navigate to the current pathname (clears any view query param)
      window.location.href = window.location.pathname;
    });
  }

  if (historyButton) {
    historyButton.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('history');
    });
  }

  if (latestFromHistoryButton) {
    latestFromHistoryButton.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('latestFromHistory');
    });
  }

  // --- Initial view logic ---
  let initialMode = 'latest';

  try {
    const params = new URLSearchParams(window.location.search);
    const userParam = params.get('user');
    const viewParam = params.get('view');

    if (viewParam === 'history') {
      initialMode = 'history';
    } else if (viewParam) {
      // preserve custom latest view modes (e.g. latestFromHistory)
      initialMode = viewParam;
    } else {
      initialMode = 'latest';

      if (userParam && userParam.trim() !== '' && !hasErrorMessage()) {
        recordSearch(userParam);
      }
    }
  } catch {}

  switchView(initialMode);

  // --- Clear history button ---
  const clearButton = document.getElementById('clearHistory');

  if (clearButton) {
    clearButton.addEventListener('click', () => {
      if (confirm('Clear all search history?')) {
        clearHistory();
      }
    });
  }

  // Fetch latest from history button
  const fetchHistoryBtn = document.getElementById('fetchHistoryLatest');
  if (fetchHistoryBtn) {
    fetchHistoryBtn.addEventListener('click', () => {
      fetchlatestFromHistory();
      // switch to a dedicated latest-from-history view so the URL reflects the action
      switchView('latestFromHistory');
    });
  }
});
