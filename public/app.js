/**
 * @file Public page script: keeps the line counter and the urgent notice
 * live, and shows the GroupMe / Instagram links and the rules.
 *
 * Talks to four read-only endpoints:
 *   GET /api/line     { active, count, label, bandsOut, updatedAt,
 *                       announcement: { message, postedAt, updatedAt } | null }
 *   GET /api/links    { groupme, instagram }  ('' = not set)
 *   GET /api/subtext  { subtext }  the note under the counter ('' = hide)
 *   GET /api/rules    { rules: string[] }
 *
 * The urgent notice rides along with the line count on purpose: one
 * request per visitor per poll instead of two, which matters at
 * game-day scale (thousands of phones polling every 10s).
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
    subtext: document.getElementById('lineSubtext'),
    noticeSection: document.getElementById('noticeSection'),
    noticeMessage: document.getElementById('noticeMessage'),
    noticeTime: document.getElementById('noticeTime'),
    socials: document.getElementById('socials'),
    groupme: document.getElementById('groupmeLink'),
    instagram: document.getElementById('instagramLink'),
    instagramHandle: document.getElementById('instagramHandle'),
    groupmeAddress: document.getElementById('groupmeAddress'),
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
    renderNotice(line.announcement || null);
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

  // ---------- Urgent notice ----------
  // Shown between the hero and the line counter only while officials have
  // one posted; otherwise the section is hidden and the page looks as usual.

  /** "10:30 PM" today, "Oct 27, 10:30 PM" on any other day. */
  function formatStamp(iso) {
    const date = new Date(iso);
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (date.toDateString() === new Date().toDateString()) return time;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  }

  /** updatedAt of the notice on screen, so an unchanged one isn't redrawn. */
  let shownNotice = null;

  function renderNotice(notice) {
    const key = notice ? notice.updatedAt : null;
    // Redrawing identical text every poll would make screen readers
    // re-announce it (the message is aria-live).
    if (key === shownNotice) return;
    shownNotice = key;
    els.noticeSection.classList.toggle('hidden', !notice);
    if (!notice) return;
    // textContent (with CSS keeping line breaks): officers type free text.
    els.noticeMessage.textContent = notice.message;
    els.noticeTime.textContent = notice.updatedAt !== notice.postedAt
      ? `Updated ${formatStamp(notice.updatedAt)}`
      : `Posted ${formatStamp(notice.postedAt)}`;
    els.noticeTime.title = `Posted ${new Date(notice.postedAt).toLocaleString()}`;
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

  // ---------- Line counter subtext ----------
  // The note under the counter (the wristband reminder). Officers can edit
  // it; blank hides it. The HTML holds the default until this loads.
  async function loadSubtext() {
    try {
      const { subtext } = await getJson('/api/subtext');
      els.subtext.textContent = subtext;
      els.subtext.classList.toggle('hidden', !subtext);
    } catch { /* keep the default text */ }
  }

  // ---------- GroupMe / Instagram ----------
  // Officers can change both links; a blank one hides its button, and the
  // whole section hides if both are blank.

  /**
   * The link as a URL if it's a well-formed https:// address, else null.
   * The server already checks this; checking again here means a bad value
   * can never become a javascript: link, and can't break the section.
   */
  function httpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  /** "@ufrowdies" from an Instagram profile link, or '' if it isn't one. */
  function instagramHandle({ hostname, pathname }) {
    const match = /^\/([A-Za-z0-9._]+)\/?$/.exec(pathname);
    return /(^|\.)instagram\.com$/i.test(hostname) && match ? `@${match[1]}` : '';
  }

  async function loadLinks() {
    try {
      const links = await getJson('/api/links');
      const groupme = httpsUrl(links.groupme);
      const instagram = httpsUrl(links.instagram);
      els.groupme.classList.toggle('hidden', !groupme);
      els.instagram.classList.toggle('hidden', !instagram);
      if (groupme) {
        els.groupme.href = groupme.href;
        // The link itself, minus https:// and www., on the card's last line.
        // A <wbr> after each "/" lets a narrow card wrap it there, not mid-word.
        const parts = groupme.href.replace(/^https:\/\/(www\.)?/, '').split(/(?<=\/)/);
        els.groupmeAddress.replaceChildren(...parts.flatMap((part) => [part, document.createElement('wbr')]));
      }
      if (instagram) {
        els.instagram.href = instagram.href;
        els.instagramHandle.textContent = instagramHandle(instagram); // '' if not a profile link
      }
      els.socials.classList.toggle('hidden', !groupme && !instagram);
    } catch {
      els.socials.classList.add('hidden');
    }
  }

  loadRules();
  loadLinks();
  loadSubtext();
  if (!document.hidden) startPolling();
})();
