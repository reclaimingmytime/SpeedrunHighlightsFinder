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

  function normalizePlayerName(name) {
    return name.toLowerCase();
  }

  function updateLatestGroupsToggle() {
    const toggleButton = document.getElementById('toggleLatestHistoryGroups');
    const groups = document.querySelectorAll('#latestMatchesContainer .player-group');
    if (!toggleButton) return;

    toggleButton.hidden = groups.length === 0;
    toggleButton.disabled = groups.length === 0;
    toggleButton.textContent = Array.from(groups).every((group) => group.open) ? 'Collapse all' : 'Expand all';
  }

  const toggleLatestGroupsButton = document.getElementById('toggleLatestHistoryGroups');
  if (toggleLatestGroupsButton) {
    toggleLatestGroupsButton.addEventListener('click', () => {
      const groups = document.querySelectorAll('#latestMatchesContainer .player-group');
      const expand = Array.from(groups).some((group) => !group.open);
      groups.forEach((group) => {
        group.open = expand;
      });
      updateLatestGroupsToggle();
    });
  }

  function renderLatestMatches(vods, notFound = [], notPlayed = [], error, expiredMatchesMessage) {
    const container = document.getElementById('latestMatchesContainer');
    const statusDiv = document.getElementById('latestFromHistoryStatus');
    if (!container) return;

    const groupOpenStates = new Map(
      Array.from(container.querySelectorAll('.player-group')).map((group) => [group.dataset.player, group.open]),
    );
    container.innerHTML = '';
    updateLatestGroupsToggle();

    // --- existing “not found / not played” blocks ---
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

    if (expiredMatchesMessage) {
      const message = document.createElement('p');
      const italic = document.createElement('em');
      italic.textContent = expiredMatchesMessage;
      message.appendChild(italic);
      container.appendChild(message);
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

    // ---------- Group by player ----------
    const groups = new Map(); // nickname → { nickname, vods: [] }

    for (const vod of vods) {
      const key = vod.vodNickname || '(unknown)';
      const normalizedName = normalizePlayerName(key);
      if (!groups.has(normalizedName)) {
        groups.set(normalizedName, { nickname: key, vods: [] });
      }
      groups.get(normalizedName).vods.push(vod);
    }

    // Keep original order from API (already newest-first globally)
    const sortedGroups = Array.from(groups.values());

    // ---------- Render groups ----------
    for (const group of sortedGroups) {
      const details = document.createElement('details');
      details.className = 'player-group';
      const normalizedName = normalizePlayerName(group.nickname);
      details.dataset.player = normalizedName;
      details.open = groupOpenStates.get(normalizedName) ?? true;
      details.addEventListener('toggle', updateLatestGroupsToggle);

      const summary = document.createElement('summary');

      // avatar + name (clickable → player page)
      const playerLink = createPlayerLink(group.nickname, {
        paddingRight: '4px',
        includeText: true,
      });
      // prevent toggling the details when clicking the player link
      playerLink.addEventListener('click', (e) => e.stopPropagation());
      summary.appendChild(playerLink);

      // count badge
      const countSpan = document.createElement('span');
      countSpan.className = 'count';
      countSpan.textContent = `· ${group.vods.length}`;
      summary.appendChild(countSpan);

      // "latest" button → most recent VOD
      if (group.vods[0]?.vodLink) {
        const latestLink = document.createElement('a');
        latestLink.href = group.vods[0].vodLink;
        latestLink.rel = 'noreferrer';
        latestLink.target = '_blank';
        latestLink.textContent = 'latest';
        latestLink.title = 'Open most recent highlight';
        latestLink.className = 'latest-btn';
        latestLink.addEventListener('click', (e) => e.stopPropagation());
        summary.appendChild(latestLink);
      }

      // most recent time (right-aligned)
      if (group.vods[0]?.vodTime) {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'last-time';
        timeSpan.textContent = group.vods[0].vodTime;
        summary.appendChild(timeSpan);
      }

      details.appendChild(summary);

      // --- body: the individual highlights ---
      const body = document.createElement('div');
      body.className = 'highlights';

      for (const vod of group.vods) {
        const p = document.createElement('p');

        const link = document.createElement('a');
        link.href = vod.vodLink;
        link.rel = 'noreferrer';
        link.target = '_blank';
        link.textContent = vod.vodTime;
        p.appendChild(link);

        body.appendChild(p);
      }

      const before = state?.pagination?.get(normalizedName);
      if (before != null) {
        const olderLink = document.createElement('a');
        olderLink.href = '#';
        olderLink.textContent = 'More';
        olderLink.setAttribute('aria-label', `Load older highlights for ${group.nickname}`);
        olderLink.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          fetchOlderHistoryPage(group.nickname);
        });
        body.appendChild(olderLink);

        const pageError = state.pageErrors.get(normalizedName);
        if (pageError) {
          const errorMessage = document.createElement('p');
          errorMessage.style.color = 'red';
          errorMessage.textContent = pageError;
          body.appendChild(errorMessage);
        }

        const pageMessage = state.pageMessages.get(normalizedName);
        if (pageMessage) {
          const message = document.createElement('p');
          message.textContent = pageMessage;
          body.appendChild(message);
        }
      }

      details.appendChild(body);
      container.appendChild(details);
    }

    updateLatestGroupsToggle();

    if (statusDiv) {
      statusDiv.innerHTML = '';
    }
  }

  async function fetchOlderHistoryPage(player) {
    if (!state) return;

    const normalizedName = normalizePlayerName(player);
    const before = state.pagination.get(normalizedName);
    if (before == null || state.loadingPlayers.has(normalizedName)) return;

    state.loadingPlayers.add(normalizedName);
    state.pageErrors.delete(normalizedName);
    state.pageMessages.delete(normalizedName);
    renderLatestMatches(state.allVods, state.notFound, state.notPlayed, undefined, state.expiredMatchesMessage);

    try {
      const params = new URLSearchParams({
        players: player,
        before: String(before),
      });
      if (state.season !== undefined) params.set('season', String(state.season));

      const res = await fetch('/api/latest?' + params.toString());
      if (!res.ok) {
        throw new Error('Could not fetch older highlights. An unexpected error occurred.');
      }

      const json = await res.json();
      const updatedVods = state.allVods.concat(json.vods || []).sort((a, b) => (b.eventUnix || 0) - (a.eventUnix || 0));
      const seenLinks = new Set();
      state.allVods = updatedVods.filter((vod) => {
        if (seenLinks.has(vod.vodLink)) return false;
        seenLinks.add(vod.vodLink);
        return true;
      });
      if (!json.vods?.length) {
        state.pageMessages.set(normalizedName, 'No highlights found on this page. Try the next page.');
      }

      const nextPage = (json.pagination || []).find((page) => normalizePlayerName(page.player) === normalizedName);
      state.pagination.set(normalizedName, nextPage?.before);
      state.expiredMatchesMessage ||= json.expiredMatchesMessage;
    } catch (err) {
      state.pageErrors.set(
        normalizedName,
        'Could not fetch older highlights. Check the browser console for more info.',
      );
      console.error(err);
    } finally {
      state.loadingPlayers.delete(normalizedName);
      renderLatestMatches(state.allVods, state.notFound, state.notPlayed, undefined, state.expiredMatchesMessage);
    }
  }

  async function fetchLatestFromHistory(loadMore = false) {
    const container = document.getElementById('latestMatchesContainer');
    if (!container) return;

    if (!loadMore || !state) {
      const history = loadHistory();
      const entries = Object.entries(history).map(([key, value]) => ({ key, ...value }));

      if (entries.length === 0) {
        state = null;
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
        pagination: new Map(),
        loadingPlayers: new Set(),
        pageErrors: new Map(),
        pageMessages: new Map(),
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
      state.pagination = new Map(
        (json.pagination || []).map((page) => [normalizePlayerName(page.player), page.before]),
      );
      state.expiredMatchesMessage = json.expiredMatchesMessage;
    } catch (err) {
      renderLatestMatches([], [], [], 'An internal error occurred. Check the browser console for more info.');
      console.error(err);
      return;
    }

    if (state.allVods.length === 0) {
      renderLatestMatches([], state.notFound, state.notPlayed, undefined, state.expiredMatchesMessage);
      return;
    }

    renderLatestMatches(state.allVods, state.notFound, state.notPlayed, undefined, state.expiredMatchesMessage);
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

      // Last searched
      const searchedTd = document.createElement('td');
      const searchedAt = Date.parse(entry.last);
      searchedTd.textContent = Number.isNaN(searchedAt) ? '—' : new Date(searchedAt).toLocaleString();
      searchedTd.setAttribute('data-sort', Number.isNaN(searchedAt) ? '' : String(searchedAt));
      tr.appendChild(searchedTd);

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

    if (viewParam === 'splits') {
      const splitsTable = document.getElementById('splitsTable');
      if (splitsTable && typeof window.DataTable === 'function') {
        const escapeHtml = (value) =>
          String(value).replace(/[&<>"']/g, (character) => {
            const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return entities[character];
          });
        const dataTable = new window.DataTable(splitsTable, {
          ajax: '/api/splits',
          serverSide: true,
          processing: true,
          order: [[4, 'desc']],
          pageLength: 25,
          lengthMenu: [10, 25, 50, 100],
          paging: true,
          ordering: true,
          searching: true,
          scrollX: true,
          columns: [
            {
              data: 'player',
              render: (player, type) =>
                type !== 'display'
                  ? player
                  : `<a href="?user=${encodeURIComponent(player)}"><img class="avatar" src="https://mineskin.eu/avatar/${encodeURIComponent(player)}/8.svg" alt="Player Avatar" /> ${escapeHtml(player)}</a>`,
            },
            {
              data: 'rankName',
              render: (rankName, type, row) =>
                type !== 'display'
                  ? (row.elo ?? -1)
                  : `${escapeHtml(row.rankEmoji)} ${escapeHtml(rankName)}${row.elo === null ? '' : ` (${row.elo})`}`,
            },
            {
              data: 'split',
              render: (split, type) => escapeHtml(split),
            },
            {
              data: 'seedType',
              render: (seedType) => escapeHtml(seedType),
            },
            {
              data: 'durationSeconds',
              render: (duration, type, row) => (type !== 'display' ? duration : escapeHtml(row.duration)),
            },
            {
              data: 'eventUnix',
              render: (eventUnix, type, row) =>
                type !== 'display'
                  ? eventUnix
                  : `<a href="${escapeHtml(row.vodLink)}" rel="noreferrer" target="_blank">${escapeHtml(row.date)}</a>`,
            },
          ],
          columnControl: ['order', ['search', 'spacer', 'orderAsc', 'orderDesc', 'orderClear']],
          columnDefs: [
            {
              target: 1,
              columnControl: {
                target: 0,
                content: [
                  'order',
                  [{ extend: 'searchList', ajaxOnly: true }, 'spacer', 'orderAsc', 'orderDesc', 'orderClear'],
                ],
              },
            },
            {
              target: 2,
              columnControl: {
                target: 0,
                content: [
                  'order',
                  [{ extend: 'searchList', ajaxOnly: true }, 'spacer', 'orderAsc', 'orderDesc', 'orderClear'],
                ],
              },
            },
            {
              target: 3,
              columnControl: {
                target: 0,
                content: [
                  'order',
                  [{ extend: 'searchList', ajaxOnly: true }, 'spacer', 'orderAsc', 'orderDesc', 'orderClear'],
                ],
              },
            },
          ],
          ordering: {
            indicators: false,
          },
          layout: {
            topStart: 'pageLength',
            topEnd: 'search',
            bottomStart: 'info',
            bottomEnd: 'paging',
          },
        });
      } else if (splitsTable) {
        console.error('DataTables or ColumnControl failed to load; splits table enhancements are unavailable.');
      }
    }

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
