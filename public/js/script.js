document.addEventListener('DOMContentLoaded', () => {
  const clearButton = document.getElementById('clearHistory');

  // -----------------------------
  // --- Toggle opponent clips ---
  // -----------------------------
  const toggle = document.getElementById('toggleOpponentClips');
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      const value = toggle.getAttribute('data-value');
      document.cookie = `includeOpponent=${value}; path=/; max-age=31536000`;
      window.location.reload();
    });
  }

  // ---------------------------
  // --- Helpers for history ---
  // ---------------------------

  const STORAGE_KEY = 'mcsr_search_history';
  const MAX_HISTORY = 100;

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.error('Error loading search history from localStorage:', err);
      return {};
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (err) {
      console.error('Error saving search history to localStorage:', err);
    }
  }

  function clearHistory() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error('Error removing search history from localStorage:', err);
    }
    renderHistory();
  }

  function normalizeKey(user) {
    return (user || '').trim().toLowerCase();
  }

  function getPlayersFromHistory(history = loadHistory()) {
    return Object.values(history)
      .map((h) => h.user)
      .filter(Boolean);
  }

  function hasErrorMessage() {
    return document.getElementById('error') !== null;
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

  function buildUrl(user) {
    const params = new URLSearchParams();
    if (user && user.trim() !== '') {
      params.set('user', user);
    }
    return window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  }

  // ---------------------------------
  // --- Player / DOM render helpers -
  // ---------------------------------

  function createAvatarImg(nickname) {
    const img = document.createElement('img');
    if (nickname) {
      img.src = 'https://mineskin.eu/avatar/' + encodeURIComponent(nickname) + '/8.svg';
    }
    img.alt = 'Player Avatar';
    img.className = 'avatar';
    return img;
  }

  function createPlayerLink(nickname, options = {}) {
    const { title = 'See all highlights by player', includeText = false, paddingRight } = options;
    const anchor = document.createElement('a');
    anchor.href = buildUrl(nickname);
    anchor.title = title;
    if (paddingRight != null) {
      anchor.style.paddingRight = paddingRight;
    }
    anchor.appendChild(createAvatarImg(nickname));
    if (includeText) {
      anchor.appendChild(document.createTextNode(' ' + (nickname || '(all)')));
    }
    return anchor;
  }

  function appendDetailsMessage(container, message, summaryText) {
    const details = document.createElement('details');
    details.style.marginBottom = '0.5rem';
    details.style.color = '#666';
    details.style.fontStyle = 'italic';

    const summary = document.createElement('summary');
    summary.style.cursor = 'pointer';
    summary.style.color = '#666';
    summary.style.fontStyle = 'italic';
    summary.textContent = summaryText;
    details.appendChild(summary);

    const infoP = document.createElement('p');
    infoP.style.color = '#666';
    infoP.style.fontStyle = 'italic';
    infoP.style.marginTop = '0.5rem';
    infoP.textContent = message;
    details.appendChild(infoP);

    container.appendChild(details);
  }

  // ---------------------------
  // --- Latest from history ---
  // ---------------------------

  let state = null;

  function renderLatestMatches(vods, notFound = [], notPlayed = [], error) {
    const container = document.getElementById('latestMatchesContainer');
    const statusDiv = document.getElementById('latestFromHistoryStatus');
    if (!container) return;

    container.innerHTML = '';

    if (notFound.length > 0) {
      appendDetailsMessage(
        container,
        `Note: ${notFound.length} user${notFound.length === 1 ? '' : 's'} not found: ${notFound.join(', ')}`,
        `${notFound.length} invalid user${notFound.length === 1 ? '' : 's'}`,
      );
    }

    if (notPlayed.length > 0) {
      appendDetailsMessage(
        container,
        `No matches found this season (including private matches) for: ${notPlayed.join(', ')}`,
        `${notPlayed.length} player${notPlayed.length === 1 ? '' : 's'} with no matches this season`,
      );
    }

    if (error) {
      const errorP = document.createElement('p');
      errorP.style.color = 'red';
      errorP.textContent = error;
      container.appendChild(errorP);
      if (statusDiv) statusDiv.innerHTML = '';
      return;
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
      p.appendChild(createPlayerLink(vod.vodNickname, { paddingRight: '4px' }));

      const link = document.createElement('a');
      link.href = vod.vodLink;
      link.rel = 'noreferrer';
      link.target = '_blank';
      link.textContent = `${vod.vodNickname} at ${vod.vodTime}`;
      p.appendChild(link);

      container.appendChild(p);
    }

    if (statusDiv) {
      statusDiv.innerHTML = '';
    }
  }

  async function fetchLatestFromHistory(loadMore = false) {
    const container = document.getElementById('latestMatchesContainer');
    if (!container) return;

    if (!loadMore || !state) {
      const history = loadHistory();
      const entries = Object.entries(history).map(([key, value]) => ({ key, ...value }));

      if (entries.length === 0) {
        renderLatestMatches([], []);
        return;
      }

      let season;
      const seasonInput = document.getElementById('season');
      if (seasonInput && seasonInput.value && seasonInput.value.trim() !== '') {
        season = Number(seasonInput.value);
      }

      state = {
        allVods: [],
        season: season,
        history: entries,
        notFound: [],
      };
    }

    // Players from the history entries we already loaded into state
    const players = state.history.map((e) => e.user).filter(Boolean);
    if (players.length === 0) {
      renderLatestMatches([], [], []);
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set('players', players.join(','));

      if (state.season !== undefined) params.set('season', String(state.season));

      const res = await fetch('/api/latest?' + params.toString());
      if (!res.ok) {
        renderLatestMatches([], [], [], 'Could not fetch latest matches. An unexpected error occurred.');
        return;
      }
      const json = await res.json();
      state.allVods = json.vods || [];
      state.notFound = json.notFound || [];
      state.notPlayed = json.notPlayed || [];
    } catch (err) {
      renderLatestMatches([], [], [], 'An internal error occurred. Check the browser console for more info.');
      console.error(err);
      return;
    }

    if (state.allVods.length === 0) {
      renderLatestMatches([], state.notFound, state.notPlayed);
      return;
    }

    renderLatestMatches(state.allVods, state.notFound, state.notPlayed);
  }

  // --- Search history (client-side using localStorage) ---

  function renderHistory() {
    const tableBody = document.getElementById('historyTableBody');
    const infoMessage = document.getElementById('historyInfoMessage');
    const historyTable = document.getElementById('historyTable');
    const recalcBtn = document.getElementById('recalcLastPublicMatches');
    if (!tableBody || !infoMessage) return;

    const history = loadHistory();
    const hasHistory = Object.keys(history).length > 0;

    if (historyTable) {
      historyTable.style.display = hasHistory ? '' : 'none';
    }
    if (clearButton) {
      clearButton.style.display = hasHistory ? '' : 'none';
    }
    if (recalcBtn) {
      recalcBtn.style.display = hasHistory ? '' : 'none';
    }

    const entries = Object.entries(history).map(([key, value]) => ({ key, ...value }));
    if (entries.length === 0) {
      tableBody.innerHTML = '';
      infoMessage.innerHTML = 'No history yet. Searches will be recorded here.';
      infoMessage.style.display = '';
      return;
    }

    entries.sort((a, b) => new Date(b.last) - new Date(a.last));
    infoMessage.innerHTML = `Search history (${entries.length}/${MAX_HISTORY}). <span title="Your ${MAX_HISTORY} most recent searches are saved; older searches are automatically removed.">&#9432;</span>`;
    infoMessage.style.display = '';

    tableBody.innerHTML = '';

    for (const entry of entries) {
      const tr = document.createElement('tr');

      // Player cell
      const playerTd = document.createElement('td');
      playerTd.appendChild(createPlayerLink(entry.user, { includeText: true }));
      tr.appendChild(playerTd);

      // Times accessed
      const countTd = document.createElement('td');
      countTd.textContent = String(entry.count || 0);
      tr.appendChild(countTd);

      // Last streamed match (initially empty)
      const publicTd = document.createElement('td');
      publicTd.textContent = '—';
      publicTd.title = 'Not calculated yet';
      publicTd.setAttribute('data-player-streamed', entry.user || '');
      publicTd.setAttribute('data-sort', '');
      tr.appendChild(publicTd);

      // Latest match (placeholder)
      const latestTd = document.createElement('td');
      latestTd.textContent = '—';
      latestTd.setAttribute('data-player-latest', entry.user || '');
      latestTd.setAttribute('data-sort', '');
      tr.appendChild(latestTd);

      // Delete button
      const delTd = document.createElement('td');
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => {
        tr.style.transition = 'opacity 0.3s ease';
        tr.style.opacity = '0';
        setTimeout(() => {
          const updatedHistory = loadHistory();
          delete updatedHistory[entry.key];
          saveHistory(updatedHistory);
          const remaining = Object.keys(updatedHistory).length;
          if (remaining === 0) {
            renderHistory();
          } else {
            tr.remove();
            infoMessage.innerHTML = `Search history (${remaining}/${MAX_HISTORY}). <span title="Your ${MAX_HISTORY} most recent searches are saved; older searches are automatically removed.">ⓘ</span>`;
          }
        }, 300);
      });
      delTd.appendChild(deleteButton);
      tr.appendChild(delTd);

      tableBody.appendChild(tr);
    }
  }

  // Fetch last match dates from server and populate table
  async function recalculateLastPublicMatches() {
    const players = getPlayersFromHistory();
    if (players.length === 0) return;

    try {
      const params = new URLSearchParams();
      params.set('players', players.join(','));
      const res = await fetch('/api/lastPublicMatches?' + params.toString());
      if (!res.ok) {
        alert('Could not fetch last matches.');
        return;
      }
      const json = await res.json();
      const latestStreamed = json.latestStreamed || {};
      const latestAll = json.latestAll || {};
      let hasStreamedMatch = false;
      let hasAnyMatch = false;

      document.querySelectorAll('[data-player-streamed]').forEach((el) => {
        const player = el.getAttribute('data-player-streamed') || '';
        const iso = latestStreamed[player] || null;
        if (iso) {
          hasStreamedMatch = true;
          const ms = Date.parse(iso);
          el.textContent = new Date(iso).toLocaleString();
          el.setAttribute('data-sort', String(ms));
          el.title = '';
        } else {
          el.textContent = 'None';
          el.setAttribute('data-sort', '');
          el.title = 'No public match with VOD found';
        }
      });

      document.querySelectorAll('[data-player-latest]').forEach((el) => {
        const player = el.getAttribute('data-player-latest') || '';
        const iso = latestAll[player] || null;
        if (iso) {
          hasAnyMatch = true;
          const ms = Date.parse(iso);
          el.textContent = new Date(iso).toLocaleString();
          el.setAttribute('data-sort', String(ms));
          el.title = '';
        } else {
          el.textContent = 'None';
          el.setAttribute('data-sort', '');
          el.title = 'No public match found';
        }
      });

      if (hasStreamedMatch) {
        document.getElementById('lastMatch')?.classList.remove('no-sort');
      }
      if (hasAnyMatch) {
        document.getElementById('latestMatch')?.classList.remove('no-sort');
      }
    } catch (err) {
      console.error(err);
      alert('Error while recalculating last matches.');
    }
  }

  // Bind recalc button
  const recalcBtn = document.getElementById('recalcLastPublicMatches');
  if (recalcBtn) {
    recalcBtn.addEventListener('click', () => {
      recalcBtn.textContent = 'Calculating...';
      recalcBtn.disabled = true;
      recalculateLastPublicMatches().finally(() => {
        recalcBtn.textContent = 'Re-calculate latest matches';
        recalcBtn.disabled = false;
      });
    });
  }

  function initializeView() {
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
