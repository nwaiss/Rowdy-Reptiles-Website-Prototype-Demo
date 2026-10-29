/**
 * @file Admin dashboard script: login, live line control, and the rules editor.
 *
 * Every API path here is relative ("api/line"), so it resolves under the
 * secret admin path this page was served from. Nothing in this file knows
 * or reveals that path. The API is documented in lib/admin-router.js.
 *
 * Sections:
 *   1. Helpers (DOM, toasts, API calls, confirm dialog, busy buttons)
 *   2. Session (login / logout)
 *   3. Line control
 *   4. Urgent message
 *   5. GroupMe / Instagram links
 *   6. Polling
 *   7. Line rules editor
 */
(function () {
  'use strict';

  /** How often the dashboard refreshes the count while visible and logged in. */
  const POLL_MS = 5000;

  const state = {
    isAdmin: false,
    /** Last admin line view from the server (see toAdminView in lib/line-store.js). */
    line: null,
    /** The rules as currently published, for detecting unsaved edits. */
    rules: [],
    /** The urgent message as currently posted, or null. */
    announcement: null,
  };

  // =====================================================================
  // 1. Helpers
  // =====================================================================

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  /** How long a toast stays up; errors stay longer so they can be read. */
  const TOAST_MS = 2500;
  const ERROR_TOAST_MS = 5000;

  /**
   * Shows a short message at the bottom of the screen. Only one shows at a
   * time (a new one replaces the old), so rapid taps can't stack a pile of
   * toasts over the controls on a phone.
   *
   * @param {string} message
   * @param {'success'|'error'} [kind]
   */
  function toast(message, kind) {
    const container = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind || ''}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = message;
    container.replaceChildren(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, kind === 'error' ? ERROR_TOAST_MS : TOAST_MS);
  }

  /**
   * Calls the admin API. A 401 (session expired) switches to the login view.
   *
   * @param {string} path   Relative path, e.g. "api/line".
   * @param {string} [method='GET']
   * @param {object} [body] Sent as JSON.
   * @returns {Promise<any>} The parsed JSON response.
   * @throws {Error} With the server's error message on failure.
   */
  async function api(path, method, body) {
    const opts = { method: method || 'GET', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch {
      throw new Error('Could not reach the server. Check your connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== 'api/login') showLoggedOut();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  /**
   * Asks the officer to confirm an action, using an in-page <dialog>.
   *
   * This replaces window.confirm(). Browsers can silence repeated confirm()
   * pop-ups (Chrome/Edge offer "prevent this page from creating additional
   * dialogs", and some phones block them), after which confirm() returns
   * false instantly. That made End This Line silently do nothing after
   * No More Bands had been cancelled. A page-drawn dialog can't be silenced.
   *
   * @param {object} options
   * @param {string} options.title
   * @param {string} options.message   Line breaks are kept.
   * @param {string} [options.confirmLabel='OK']
   * @param {'accent'|'warning'|'danger'} [options.tone='accent'] Color of the confirm button.
   * @returns {Promise<boolean>} true only if the officer pressed the confirm button.
   */
  function confirmAction({ title, message, confirmLabel = 'OK', tone = 'accent' }) {
    const dialog = $('#confirmDialog');
    if (dialog.open) return Promise.resolve(false);
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    const ok = $('#confirmOk');
    ok.textContent = confirmLabel;
    ok.className = `btn btn-${tone}`;
    dialog.returnValue = '';
    dialog.showModal();
    $('#confirmCancel').focus(); // the safe choice is the default
    return new Promise((resolve) => {
      // Fires for both buttons, the Escape key and a backdrop click.
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    });
  }

  /**
   * Two confirmations for undoing No More Bands or Capacity Reached (the
   * user asked for both): first our in-page dialog, then the browser's own
   * confirm() pop-up.
   *
   * Browsers can silence confirm() (the bug confirmAction exists to avoid).
   * When they do, it returns false instantly, so the undo is simply refused,
   * which is the safe way to fail. A silenced pop-up returns in a few
   * milliseconds, faster than any person can click, so that's how we spot
   * it and tell the officer what to do.
   *
   * @param {{title: string, message: string, browserMessage: string}} options
   * @returns {Promise<boolean>} true only if both were confirmed.
   */
  async function confirmUndo({ title, message, browserMessage }) {
    const first = await confirmAction({ title, message, confirmLabel: 'Undo', tone: 'danger' });
    if (!first) return false;
    const shownAt = performance.now();
    const second = window.confirm(browserMessage);
    if (!second && performance.now() - shownAt < 50) {
      toast('Your browser blocked its confirmation pop-up, so nothing was changed. Close this tab, open the dashboard link again, and retry.', 'error');
    }
    return second;
  }

  // A click on the dimmed backdrop (outside the box) cancels.
  $('#confirmDialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close('cancel');
  });

  /**
   * Disables a button while `task` runs, so a double tap can't send twice.
   * @template T
   * @param {HTMLButtonElement|null} button
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  async function withBusy(button, task) {
    if (button) button.disabled = true;
    try {
      return await task();
    } finally {
      if (button) button.disabled = false;
    }
  }

  // =====================================================================
  // 2. Session
  // =====================================================================

  function showLoggedOut() {
    state.isAdmin = false;
    stopPolling();
    closeRulesEditor();
    closeLinksEditor();
    $('#adminLoggedIn').classList.add('hidden');
    $('#adminLoggedOut').classList.remove('hidden');
  }

  function showLoggedIn() {
    state.isAdmin = true;
    $('#adminLoggedOut').classList.add('hidden');
    $('#adminLoggedIn').classList.remove('hidden');
    loadRules();
    startPolling();
  }

  async function refreshSession() {
    try {
      const { isAdmin } = await api('api/session');
      if (isAdmin) showLoggedIn(); else showLoggedOut();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const errorEl = $('#loginError');
    errorEl.classList.add('hidden');
    withBusy($('#loginForm button[type="submit"]'), async () => {
      try {
        await api('api/login', 'POST', { password: $('#adminPassword').value });
        $('#adminPassword').value = '';
        toast('Logged in.', 'success');
        showLoggedIn();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('api/logout', 'POST', {}); } catch { /* logged out locally either way */ }
    showLoggedOut();
    toast('Logged out.');
  });

  // =====================================================================
  // 3. Line control
  // =====================================================================

  /** "9:41:07 PM" */
  function formatTime(iso) {
    return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
  }

  /** Shows whether the Google Sheet is connected and readable. */
  function renderSheetStatus(sheet) {
    const el = $('#sheetStatus');
    let text;
    let ok = false;
    if (!sheet.configured) {
      text = sheet.error
        ? `Google Sheet not connected: ${sheet.error} The count is the extra amount only.`
        : 'Google Sheet not connected. The count is the extra amount only.';
    } else if (sheet.ok) {
      text = `Google Sheet connected · last read ${formatTime(sheet.readAt)}`;
      ok = true;
    } else if (sheet.readAt) {
      text = `Can't read the Google Sheet right now (${sheet.error}). Using its last number, from ${formatTime(sheet.readAt)}.`;
    } else {
      text = `Can't read the Google Sheet (${sheet.error || 'no response yet'}). Counting the extra amount only.`;
    }
    el.textContent = text;
    el.classList.toggle('ok', ok);
    el.classList.toggle('warn', !ok);
  }

  /** Toggles the `hidden` class: shown when `show` is true. */
  function showIf(selector, show) {
    $(selector).classList.toggle('hidden', !show);
  }

  function renderLine(line) {
    state.line = line;
    const admitted = line.active && line.mode === 'admitted';
    renderSheetStatus(line.sheet);
    showIf('#lineStartCard', !line.active);
    showIf('#lineLiveControls', line.active);

    // The live display mirrors the public scoreboard, orange in stadium mode.
    $('#adminLiveDisplay').classList.toggle('admitted', admitted);
    $('#adminLineCount').textContent = line.active ? line.count : '—';
    $('#adminLineLabelDisplay').textContent = line.active ? line.label : '';
    if (admitted) {
      $('#adminCountBreakdown').textContent = 'Students admitted into the stadium';
    } else {
      const sign = line.extra < 0 ? '−' : '+';
      const base = line.sheet.configured ? `Sheet ${line.base}` : 'No sheet';
      $('#adminCountBreakdown').textContent = line.active ? `${base} ${sign} ${Math.abs(line.extra)} extra` : '';
    }
    showIf('#adminBandNotice', line.active && !admitted && line.bandsOut);
    showIf('#adminCapacityNotice', admitted && line.capacityReached);

    // Only the controls for the current mode are shown.
    showIf('#lineModeControls', !admitted);
    showIf('#noMoreBandsBtn', !admitted);
    showIf('#admittedModeControls', admitted);
    showIf('#capacityReachedBtn', admitted);
    setUndoableFlag('#noMoreBandsBtn', line.bandsOut, 'No More Bands', 'Undo No More Bands');
    setUndoableFlag('#capacityReachedBtn', line.capacityReached, 'Capacity Reached', 'Undo Capacity Reached');
    $('#modeSwitchBtn').textContent = admitted ? 'Back to Line Count' : 'Switch to Stadium Count';
  }

  /**
   * A flag button (No More Bands / Capacity Reached) turns into its own undo
   * button once the flag is set: navy instead of amber, so it doesn't look
   * like the original action.
   */
  function setUndoableFlag(selector, isSet, label, undoLabel) {
    const btn = $(selector);
    btn.textContent = isSet ? undoLabel : label;
    btn.classList.toggle('btn-warning', !isSet);
    btn.classList.toggle('adjust-btn', isSet);
  }

  // Responses can arrive out of order (a slow poll finishing after a
  // button press). Each line request gets a number, and an older response
  // never overwrites a newer one, so the count can't jump backwards.
  let lineRequestSeq = 0;
  let lineRenderedSeq = 0;

  /**
   * Sends a line request and renders the result if it's still the newest.
   * @returns {Promise<boolean>} Whether the request succeeded.
   */
  async function lineRequest(path, method, body) {
    const seq = ++lineRequestSeq;
    const line = await api(path, method, body);
    if (seq > lineRenderedSeq) {
      lineRenderedSeq = seq;
      renderLine(line);
    }
    return true;
  }

  /**
   * Runs an officer action on the line: disables its button meanwhile,
   * then shows a success or error toast.
   */
  function lineAction(button, path, method, body, successMessage) {
    return withBusy(button, async () => {
      try {
        await lineRequest(path, method, body);
        if (successMessage) toast(successMessage, 'success');
        return true;
      } catch (err) {
        toast(err.message, 'error');
        return false;
      }
    });
  }

  async function loadLine() {
    if (!state.isAdmin) return;
    try {
      await lineRequest('api/line');
    } catch { /* a 401 switches to login; anything else, the next poll retries */ }
  }

  $('#lineStartForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const started = await lineAction(e.submitter || $('#lineStartForm button'), 'api/line/start', 'POST', {
      label: $('#lineLabelInput').value,
      extra: $('#lineExtraStartInput').value,
    }, 'Line started.');
    if (started) {
      $('#lineLabelInput').value = '';
      $('#lineExtraStartInput').value = '0';
    }
  });

  // Typing a number and pressing Set (or Enter) is the main way to enter the count.
  $('#extraSetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#extraSetInput');
    if (input.value.trim() === '') { toast('Enter a number first.', 'error'); return; }
    const saved = await lineAction(e.submitter || $('#extraSetForm button'), 'api/line/extra', 'PUT', { extra: input.value }, 'Extra count updated.');
    if (saved) input.value = '';
  });

  // +1 / −1 aren't disabled while busy: quick repeated taps should all count.
  $('#lineQuickAdjust').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delta]');
    if (btn) lineAction(null, 'api/line/extra', 'PATCH', { delta: Number(btn.dataset.delta) });
  });

  // No More Bands, or its undo once set (see setUndoableFlag in renderLine).
  $('#noMoreBandsBtn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (state.line?.bandsOut) {
      const confirmed = await confirmUndo({
        title: 'Undo "No More Bands"?',
        message: 'Students will stop seeing "Last band was given out". Only do this if it was marked by mistake.',
        browserMessage: 'Are you sure? This removes "Last band was given out" from the public site.',
      });
      if (confirmed) lineAction(button, 'api/line/no-more-bands', 'DELETE', {}, 'Undone: bands are available again.');
      return;
    }
    const confirmed = await confirmAction({
      title: 'No more bands?',
      message: 'Everyone checking the line will see "Last band was given out". Only do this once the wristbands have actually run out.',
      confirmLabel: 'No More Bands',
      tone: 'warning',
    });
    if (confirmed) lineAction(button, 'api/line/no-more-bands', 'POST', {}, 'Marked: last band given out.');
  });

  // ----- Stadium count (doors open) -----

  // Switches the public counter between the line count and the stadium
  // count. Both directions ask first: it changes what every student sees.
  $('#modeSwitchBtn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const toAdmitted = state.line?.mode !== 'admitted';
    const confirmed = await confirmAction(toAdmitted
      ? {
        title: 'Switch to the stadium count?',
        message: 'The public counter will turn orange and show how many students have been admitted into the stadium, instead of how many are in line.\n\nYou\'ll type the admitted number in yourself.',
        confirmLabel: 'Switch',
      }
      : {
        title: 'Back to the line count?',
        message: 'The public counter will go back to showing how many people are in line.',
        confirmLabel: 'Switch Back',
      });
    if (!confirmed) return;
    lineAction(button, 'api/line/mode', 'POST', { mode: toAdmitted ? 'admitted' : 'line' },
      toAdmitted ? 'Now showing the stadium count.' : 'Now showing the line count.');
  });

  // The admitted count is typed in only (no +/− buttons), and needs no
  // confirmation: it's a number field, not a button that could be misclicked.
  $('#admittedSetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#admittedSetInput');
    if (input.value.trim() === '') { toast('Enter a number first.', 'error'); return; }
    const saved = await lineAction(e.submitter || $('#admittedSetForm button'), 'api/line/admitted', 'PUT', { admitted: input.value }, 'Admitted count updated.');
    if (saved) input.value = '';
  });

  // Capacity Reached, or its undo once set.
  $('#capacityReachedBtn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (state.line?.capacityReached) {
      const confirmed = await confirmUndo({
        title: 'Undo "Capacity Reached"?',
        message: 'Students will stop seeing "Capacity reached: no more seats". Only do this if it was marked by mistake or seats opened back up.',
        browserMessage: 'Are you sure? This removes "Capacity reached" from the public site.',
      });
      if (confirmed) lineAction(button, 'api/line/capacity-reached', 'DELETE', {}, 'Undone: capacity no longer marked as reached.');
      return;
    }
    const confirmed = await confirmAction({
      title: 'Capacity reached?',
      message: 'Everyone checking the site will see that the stadium is full and there are no more seats. Only do this once seating has actually run out.',
      confirmLabel: 'Capacity Reached',
      tone: 'warning',
    });
    if (confirmed) lineAction(button, 'api/line/capacity-reached', 'POST', {}, 'Marked: capacity reached.');
  });

  $('#stopLineBtn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const label = state.line?.label || 'this line';
    const confirmed = await confirmAction({
      title: `End ${label}?`,
      message: 'Students will see the line as closed. This can\'t be undone.',
      confirmLabel: 'End This Line',
      tone: 'danger',
    });
    if (confirmed) lineAction(button, 'api/line/stop', 'POST', {}, 'Line ended.');
  });

  // =====================================================================
  // 4. Urgent message
  // =====================================================================
  // One message at a time. Posting while one is up replaces it (the home
  // page then says "Updated" with the new time); Take Down removes it and
  // the home page goes back to normal.

  /** "Oct 28, 10:30 PM" */
  function formatStamp(iso) {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /** What was last put in the text box from the server, to spot officer edits. */
  let announcementPrefill = '';

  function updateAnnouncementCount() {
    $('#announcementCount').textContent = $('#announcementInput').value.length;
  }

  function renderAnnouncement(announcement) {
    const previous = state.announcement;
    state.announcement = announcement;
    const live = Boolean(announcement);
    showIf('#announcementLive', live);
    showIf('#announcementRemoveBtn', live);
    $('#announcementPostBtn').textContent = live ? 'Update Message' : 'Post Message';
    $('#announcementInputLabel').textContent = live ? 'Edit the message' : 'New message';
    if (live) {
      $('#announcementLiveText').textContent = announcement.message;
      $('#announcementLiveTime').textContent = announcement.updatedAt !== announcement.postedAt
        ? `Updated ${formatStamp(announcement.updatedAt)}`
        : `Posted ${formatStamp(announcement.postedAt)}`;
    }
    // Load the live message into the box for editing, unless the officer
    // has already started typing something else.
    const input = $('#announcementInput');
    if (previous?.updatedAt !== announcement?.updatedAt && input.value === announcementPrefill) {
      announcementPrefill = live ? announcement.message : '';
      input.value = announcementPrefill;
      updateAnnouncementCount();
    }
  }

  async function loadAnnouncement() {
    if (!state.isAdmin) return;
    try {
      renderAnnouncement((await api('/api/announcement')).announcement);
    } catch { /* the next poll retries */ }
  }

  $('#announcementInput').addEventListener('input', updateAnnouncementCount);

  $('#announcementForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#announcementPostBtn');
    const message = $('#announcementInput').value.trim();
    if (!message) { toast('Type a message first.', 'error'); return; }
    const updating = Boolean(state.announcement);
    if (updating && message === state.announcement.message) { toast('No changes to post.'); return; }
    const confirmed = await confirmAction(updating
      ? {
        title: 'Update the urgent message?',
        message: `Everyone on the site will see the new wording, marked with the time it was updated:\n\n${message}`,
        confirmLabel: 'Update',
        tone: 'danger',
      }
      : {
        title: 'Post this urgent message?',
        message: `It will show in red at the top of the home page for everyone, with the time it was posted:\n\n${message}`,
        confirmLabel: 'Post',
        tone: 'danger',
      });
    if (!confirmed) return;
    await withBusy(button, async () => {
      try {
        const { announcement } = await api('api/announcement', 'PUT', { message });
        // The box now matches what's live, so later polls may refresh it.
        announcementPrefill = $('#announcementInput').value = announcement.message;
        updateAnnouncementCount();
        renderAnnouncement(announcement);
        toast(updating ? 'Message updated.' : 'Message posted.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  $('#announcementRemoveBtn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const confirmed = await confirmAction({
      title: 'Take down the urgent message?',
      message: 'It will disappear from the home page, which goes back to normal.',
      confirmLabel: 'Take Down',
      tone: 'danger',
    });
    if (!confirmed) return;
    await withBusy(button, async () => {
      try {
        await api('api/announcement', 'DELETE', {});
        renderAnnouncement(null);
        toast('Message taken down.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  // =====================================================================
  // 5. GroupMe / Instagram links
  // =====================================================================

  // Edited in their own view (like the rules), opened from "Edit Links".

  /** The links as currently published, for detecting unsaved edits. */
  let savedLinks = null;

  function editorLinks() {
    return { groupme: $('#groupmeInput').value.trim(), instagram: $('#instagramInput').value.trim() };
  }

  function hasUnsavedLinkChanges() {
    return JSON.stringify(editorLinks()) !== JSON.stringify(savedLinks);
  }

  async function openLinksEditor() {
    try {
      savedLinks = await api('/api/links');
    } catch {
      toast('Could not load the current links. Try again.', 'error');
      return;
    }
    $('#groupmeInput').value = savedLinks.groupme;
    $('#instagramInput').value = savedLinks.instagram;
    $('#adminMain').classList.add('hidden');
    $('#linksEditor').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function closeLinksEditor() {
    $('#linksEditor').classList.add('hidden');
    $('#adminMain').classList.remove('hidden');
  }

  $('#editLinksBtn').addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Edit the links?',
      message: 'You\'ll be able to change where the home page\'s GroupMe and Instagram buttons go.',
      confirmLabel: 'Open Editor',
    });
    if (confirmed) openLinksEditor();
  });

  $('#cancelLinksBtn').addEventListener('click', async () => {
    if (hasUnsavedLinkChanges()) {
      const discard = await confirmAction({
        title: 'Discard your changes?',
        message: 'The links will stay exactly as they are now.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!discard) return;
    }
    closeLinksEditor();
  });

  $('#linksForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#saveLinksBtn');
    if (!hasUnsavedLinkChanges()) { toast('No changes to save.'); closeLinksEditor(); return; }
    const confirmed = await confirmAction({
      title: 'Save these links?',
      message: 'The home page\'s GroupMe and Instagram buttons will go to these addresses for everyone. A blank link hides its button.',
      confirmLabel: 'Save',
    });
    if (!confirmed) return;
    await withBusy(button, async () => {
      try {
        savedLinks = await api('api/links', 'PUT', editorLinks());
        closeLinksEditor();
        toast('Links saved.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  // =====================================================================
  // 6. Polling (only while logged in and the tab is visible)
  // =====================================================================
  let pollTimer = null;

  /** One poll: the line and the urgent message (another officer may change either). */
  function refresh() {
    loadLine();
    loadAnnouncement();
  }

  function startPolling() {
    if (pollTimer || !state.isAdmin || document.hidden) return;
    refresh();
    pollTimer = setInterval(refresh, POLL_MS);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });

  // =====================================================================
  // 7. Line rules editor
  // =====================================================================

  async function loadRules() {
    try {
      // The public endpoint is never served stale from cache (Cache-Control:
      // no-cache), so this always reflects another officer's latest save.
      const res = await fetch('/api/rules');
      if (!res.ok) throw new Error();
      state.rules = (await res.json()).rules;
      return true;
    } catch {
      return false;
    }
  }

  /** Builds one editable rule row. The text goes in via .value, never as HTML. */
  function ruleEditorItem(text) {
    const li = document.createElement('li');
    li.className = 'rule-edit-item';
    li.innerHTML = `
      <div class="rule-edit-head">
        <span class="rule-edit-num"></span>
        <div class="rule-edit-tools">
          <button type="button" class="rule-tool" data-action="up">&uarr; Up</button>
          <button type="button" class="rule-tool" data-action="down">&darr; Down</button>
          <button type="button" class="rule-tool rule-tool-remove" data-action="remove">Remove</button>
        </div>
      </div>
      <textarea rows="3" maxlength="500"></textarea>`;
    li.querySelector('textarea').value = text;
    return li;
  }

  /** Renumbers the rows and disables Up on the first / Down on the last. */
  function refreshRuleEditor() {
    const items = $all('.rule-edit-item', $('#rulesEditorList'));
    items.forEach((li, i) => {
      li.querySelector('.rule-edit-num').textContent = `Rule ${i + 1}`;
      li.querySelector('textarea').setAttribute('aria-label', `Rule ${i + 1}`);
      li.querySelector('[data-action="up"]').disabled = i === 0;
      li.querySelector('[data-action="down"]').disabled = i === items.length - 1;
    });
  }

  /** The editor's rules, tidied the same way the server tidies them. */
  function editorRules() {
    return $all('#rulesEditorList textarea').map((t) => t.value.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function hasUnsavedRuleChanges() {
    return JSON.stringify(editorRules()) !== JSON.stringify(state.rules);
  }

  async function openRulesEditor() {
    if (!await loadRules()) {
      toast('Could not load the current rules. Try again.', 'error');
      return;
    }
    $('#rulesEditorList').replaceChildren(...state.rules.map(ruleEditorItem));
    refreshRuleEditor();
    $('#adminMain').classList.add('hidden');
    $('#rulesEditor').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function closeRulesEditor() {
    $('#rulesEditor').classList.add('hidden');
    $('#adminMain').classList.remove('hidden');
    $('#rulesEditorList').replaceChildren();
  }

  $('#editRulesBtn').addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Edit the line rules?',
      message: 'You\'ll be able to change the official line rules shown on the home page.',
      confirmLabel: 'Open Editor',
    });
    if (confirmed) openRulesEditor();
  });

  $('#rulesEditorList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const li = btn.closest('.rule-edit-item');
    if (btn.dataset.action === 'up' && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
    if (btn.dataset.action === 'down' && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
    if (btn.dataset.action === 'remove') li.remove();
    refreshRuleEditor();
  });

  $('#addRuleBtn').addEventListener('click', () => {
    const li = ruleEditorItem('');
    $('#rulesEditorList').appendChild(li);
    refreshRuleEditor();
    li.querySelector('textarea').focus();
  });

  $('#cancelRulesBtn').addEventListener('click', async () => {
    if (hasUnsavedRuleChanges()) {
      const discard = await confirmAction({
        title: 'Discard your changes?',
        message: 'The line rules will stay exactly as they are now.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!discard) return;
    }
    closeRulesEditor();
  });

  $('#saveRulesBtn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const rules = editorRules();
    if (!rules.length) { toast('Add at least one rule before saving.', 'error'); return; }
    if (!hasUnsavedRuleChanges()) { toast('No changes to save.'); closeRulesEditor(); return; }
    const confirmed = await confirmAction({
      title: 'Publish as the official rules?',
      message: `Exactly what you typed (${rules.length} rule${rules.length === 1 ? '' : 's'}) will replace the current rules on the home page for everyone.\n\nDouble-check spelling and wording first.`,
      confirmLabel: 'Publish',
    });
    if (!confirmed) return;
    await withBusy(button, async () => {
      try {
        const saved = await api('api/rules', 'PUT', { rules });
        state.rules = saved.rules;
        closeRulesEditor();
        toast('Line rules updated.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  refreshSession();
})();
