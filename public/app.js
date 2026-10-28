/**
 * @file Public page script: keeps the line counter live and shows the rules.
 *
 * Talks to two read-only endpoints:
 *   GET /api/line   { active, count, label, bandsOut, updatedAt }
 *   GET /api/rules  { rules: string[] }
 *
 * Polling pauses while the tab is hidden and catches up the moment it's
 * visible again. On game day thousands of phones have this page open in
 * background tabs, so this saves the server (and their batteries) a lot.
 */
(function () {
  'use strict';

  /** How often a visible page re-checks the line count. */
  const POLL_MS = 10000;

  const els = {
    scoreboard: document.getElementById('scoreboard'),
    badge: document.getElementById('lineStatusBadge'),
    count: document.getElementById('lineCount'),
    caption: document.getElementById('lineCaption'),
    label: document.getElementById('lineLabel'),
    updated: document.getElementById('lineUpdated'),
    bandNotice: document.getElementById('lineBandNotice'),
    capacityNotice: document.getElementById('lineCapacityNotice'),
    note: document.getElementById('lineCounterNote'),
    rules: document.getElementById('rulesList'),
  };

  /**
   * Wording for each mode. 'line': people waiting outside. 'admitted':
   * doors are open and the count is students let into the stadium (the
   * scoreboard also turns orange via the .admitted class).
   */
  const MODE_TEXT = {
    line: {
      caption: 'in line',
      note: 'Updates automatically while this page is open.',
    },
    admitted: {
      caption: 'inside the stadium',
      note: 'The counter above now shows how many students have been admitted into the stadium. Updates automatically while this page is open.',
    },
  };

  /**
   * GETs a JSON endpoint.
   * @param {string} path
   * @returns {Promise<any>}
   * @throws {Error} On network failure or a non-2xx response.
   */
  async function getJson(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }

  // ---------- Line counter ----------

  /**
   * "updated just now" / "updated 5 mins ago" / "updated 2 hrs ago".
   * @param {string|null} iso
   */
  function formatUpdated(iso) {
    if (!iso) return '';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return 'updated just now';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `updated ${mins} min${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.round(mins / 60);
    return `updated ${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  }

  /** Last count drawn, so the number only flashes when it actually changes. */
  let lastCount = null;

  function renderLine(line) {
    els.badge.textContent = line.active ? 'Live' : 'No active line';
    els.badge.classList.toggle('active', line.active);
    els.count.textContent = line.active ? line.count : '—';
    if (line.active && lastCount !== null && lastCount !== line.count) {
      // Restart the flash animation even if it's mid-flash (reading
      // offsetWidth forces the browser to apply the class removal first).
      els.count.classList.remove('flash');
      void els.count.offsetWidth;
      els.count.classList.add('flash');
    }
    lastCount = line.active ? line.count : null;
    els.label.textContent = line.active ? line.label : '';
    els.updated.textContent = line.active ? formatUpdated(line.updatedAt) : '';

    const admitted = line.active && line.mode === 'admitted';
    const text = MODE_TEXT[admitted ? 'admitted' : 'line'];
    els.scoreboard.classList.toggle('admitted', admitted);
    els.caption.textContent = text.caption;
    els.note.textContent = text.note;
    // Wristbands only matter while people are lining up; seats once they're inside.
    els.bandNotice.classList.toggle('hidden', !(line.active && !admitted && line.bandsOut));
    els.capacityNotice.classList.toggle('hidden', !(admitted && line.capacityReached));
  }

  async function loadLine() {
    try {
      renderLine(await getJson('/api/line'));
    } catch {
      // Keep the last good count on screen; just flag that it may be stale.
      els.badge.textContent = 'Unavailable';
      els.badge.classList.remove('active');
    }
  }

  // ---------- Polling (pauses in background tabs) ----------
  let pollTimer = null;

  function startPolling() {
    if (pollTimer) return;
    loadLine();
    pollTimer = setInterval(loadLine, POLL_MS);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });

  // ---------- Line rules ----------
  // Rendered with textContent, never innerHTML: the rules are free text an
  // club officer typed, so they must show exactly as typed and never run as markup.
  async function loadRules() {
    try {
      const { rules } = await getJson('/api/rules');
      els.rules.replaceChildren(...rules.map((rule) => {
        const li = document.createElement('li');
        li.textContent = rule;
        return li;
      }));
    } catch {
      const li = document.createElement('li');
      li.className = 'rules-loading';
      li.textContent = 'Could not load the line rules right now.';
      els.rules.replaceChildren(li);
    }
  }

  loadRules();
  if (!document.hidden) startPolling();
})();
