document.addEventListener('DOMContentLoaded', () => {
  const clearButton = document.getElementById('clearHistory');

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

  let state = null;

  function renderLatestMatches(vods, notFound = []) {
    const container = document.getElementById('latestMatchesContainer');
    const statusDiv = document.getElementById('latestFromHistoryStatus');
    if (!container) return;

    container.innerHTML = '';

    // Display info about users not found
    if (notFound.length > 0) {
      const infoP = document.createElement('p');
      infoP.style.color = '#666';
      infoP.style.fontStyle = 'italic';
      infoP.textContent = `Note: ${notFound.length} user${notFound.length === 1 ? '' : 's'} not found: ${notFound.join(', ')}`;
      container.appendChild(infoP);
    }

    if (!vods || vods.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No highlights found.';
      container.appendChild(p);
      if (statusDiv) statusDiv.innerHTML = '';
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
      img.style.marginRight = '8px';

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

    // Remove loading text
    if (statusDiv) {
      statusDiv.innerHTML = '';
    }
  }

  async function fetchLatestFromHistory(loadMore = false) {
    const container = document.getElementById('latestMatchesContainer');
    if (!container) return;

    // Initialize state on first call
    if (!loadMore || !state) {
      const history = loadHistory();
      const entries = Object.entries(history).map(([key, value]) => ({ key, ...value }));

      if (entries.length === 0) {
        renderLatestMatches([], []);
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

      state = {
        allVods: [],
        season: season,
        history: entries,
        notFound: [],
      };

      container.innerHTML = '';
    }

    // Batch-fetch latest vods for all players server-side to reduce client load
    const players = state.history.map((e) => e.user).filter(Boolean);
    if (players.length === 0) {
      renderLatestMatches([], []);
      return;
    }

    try {
      const params = new URLSearchParams();
      // Send players as a single comma-separated string
      params.set('players', players.join(','));
      if (state.season !== undefined) params.set('season', String(state.season));

      const res = await fetch('/api/latest?' + params.toString());
      if (!res.ok) {
        renderLatestMatches([], []);
        return;
      }
      const json = await res.json();
      state.allVods = json.vods || [];
      state.notFound = json.notFound || [];
    } catch (err) {
      renderLatestMatches([], []);
      return;
    }

    if (state.allVods.length === 0) {
      renderLatestMatches([], state.notFound);
      return;
    }

    renderLatestMatches(state.allVods, state.notFound);
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
    const historyContainer = document.getElementById('historyContainer');

    const emptyMessage = document.getElementById('historyEmptyMessage');

    if (!historyContainer || !emptyMessage) return;

    const history = loadHistory();

    if (clearButton) {
      clearButton.style.display = Object.keys(history).length > 0 ? '' : 'none';
    }

    const entries = Object.entries(history).map(([key, value]) => ({
      key,
      ...value,
    }));

    if (entries.length === 0) {
      historyContainer.innerHTML = '';

      emptyMessage.style.display = '';

      return;
    }

    emptyMessage.style.display = 'none';

    entries.sort((a, b) => new Date(b.last) - new Date(a.last));

    historyContainer.innerHTML = '';

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
      deleteButton.style.marginLeft = '10px';

      deleteButton.addEventListener('click', () => {
        const updatedHistory = loadHistory();

        delete updatedHistory[entry.key];

        saveHistory(updatedHistory);

        renderHistory();
      });

      // assemble
      p.appendChild(playerLink);
      p.appendChild(deleteButton);

      historyContainer.appendChild(p);
    }
  }

  function initializeView() {
    try {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view');

      if (viewParam === 'history') {
        renderHistory();
        return;
      }

      if (viewParam === 'latestFromHistory') {
        fetchLatestFromHistory();
        return;
      }

      const userParam = params.get('user');

      if (userParam && userParam.trim() !== '' && !hasErrorMessage()) {
        recordSearch(userParam);
      }
    } catch {}
  }

  initializeView();

  // --- Clear history button ---
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      if (confirm('Clear all search history?')) {
        clearHistory();
      }
    });
  }
});
