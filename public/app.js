(function () {
  'use strict';

  const state = { isAdmin: false, adminConfigured: true };

  // The public site is one page ('home': hero, line counter, line rules);
  // the only other view is the admin dashboard.
  const DEFAULT_TAB = 'home';
  const VALID_TABS = ['home', 'admin'];
  // Old links to tabs that were removed or merged into the home page land
  // there instead of being ignored. The ones that became a section of the
  // home page also scroll to that section.
  const RETIRED_TABS = ['about', 'socials', 'donate', 'line', 'line-rules'];
  const RETIRED_TAB_SECTIONS = { line: 'lineCounter', 'line-rules': 'lineRules' };
  // Demo build: GitHub Pages has no server to rewrite clean paths like
  // /admin back to index.html, so routing lives in the hash instead
  // (#admin). Returns null for a hash that isn't one of ours (e.g. the
  // "Skip to content" link's #main) so the current tab is left alone.
  function tabFromHash(hash) {
    const clean = (hash || '').replace(/^#/, '');
    if (clean === '' || RETIRED_TABS.includes(clean)) return DEFAULT_TAB;
    return VALID_TABS.includes(clean) ? clean : null;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function toast(message, kind) {
    const container = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind || ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  // Demo build: no backend exists, so every call that used to hit the
  // Express server (see mock-api.js) is served from an in-browser mock
  // with the same paths, payloads, and error shapes as the real API.
  async function api(path, options) {
    return window.RowdyMockApi.call(path, options);
  }

  // ---------- Tabs / routing ----------
  function showTab(name, opts) {
    const options = opts || {};
    if (!VALID_TABS.includes(name)) name = DEFAULT_TAB;
    $all('.tab').forEach((t) => t.classList.add('hidden'));
    const target = document.getElementById(name);
    if (target) target.classList.remove('hidden');
    window.scrollTo(0, 0);
    $all('[data-tab]').forEach((b) => b.removeAttribute('aria-current'));
    $all(`[data-tab="${name}"]`).forEach((b) => b.setAttribute('aria-current', 'page'));

    const hash = name === DEFAULT_TAB ? '' : `#${name}`;
    if (options.push !== false && location.hash !== hash) {
      history.pushState(null, '', hash || location.pathname);
    } else if (options.push === false && hash === '' && location.hash) {
      // Landed via a retired hash (#about, #line, ...) — clean it up, and
      // jump to the matching home-page section if there is one.
      const section = RETIRED_TAB_SECTIONS[location.hash.replace(/^#/, '')];
      history.replaceState(null, '', location.pathname);
      if (section) document.getElementById(section).scrollIntoView();
    }
    if (name === 'admin') refreshAdminSession();
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-tab]');
    if (!link) return;
    e.preventDefault();
    showTab(link.dataset.tab);
  });

  function handleHashNav() {
    const tab = tabFromHash(location.hash);
    if (tab) showTab(tab, { push: false });
  }
  window.addEventListener('popstate', handleHashNav);
  window.addEventListener('hashchange', handleHashNav);


  // ---------- Line counter (public) ----------
  function formatUpdated(iso) {
    if (!iso) return '';
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'updated just now';
    const mins = Math.round(seconds / 60);
    return `updated ${mins} min${mins === 1 ? '' : 's'} ago`;
  }

  let lastRenderedCount = null;
  async function loadLine() {
    try {
      const line = await api('/api/line');
      $('#lineStatusBadge').textContent = line.active ? 'Live' : 'No active line';
      $('#lineStatusBadge').classList.toggle('active', line.active);
      const countEl = $('#lineCount');
      const displayValue = line.active ? line.count : '—';
      countEl.textContent = displayValue;
      if (line.active && lastRenderedCount !== null && lastRenderedCount !== line.count) {
        countEl.classList.remove('flash');
        // eslint-disable-next-line no-unused-expressions
        countEl.offsetWidth; // restart the animation even if it's already mid-flash
        countEl.classList.add('flash');
      }
      lastRenderedCount = line.active ? line.count : null;
      $('#lineLabel').textContent = line.active ? (line.label || '') : '';
      $('#lineUpdated').textContent = line.active && line.updatedAt ? formatUpdated(line.updatedAt) : '';

      state.line = line;
      if ($('#adminLineCount')) $('#adminLineCount').textContent = line.active ? line.count : '—';
      if ($('#adminLineLabelDisplay')) $('#adminLineLabelDisplay').textContent = line.label || '';
      if ($('#lineStartCard')) $('#lineStartCard').classList.toggle('hidden', line.active);
      if ($('#lineLiveControls')) $('#lineLiveControls').classList.toggle('hidden', !line.active);
      const bandsOut = line.active && line.bandsOut;
      if ($('#lineBandNotice')) $('#lineBandNotice').classList.toggle('hidden', !bandsOut);
      if ($('#adminBandNotice')) $('#adminBandNotice').classList.toggle('hidden', !bandsOut);
      return line;
    } catch (e) {
      $('#lineStatusBadge').textContent = 'Unavailable';
    }
  }

  // ---------- Line rules (public) ----------
  // Rendered with textContent, never innerHTML — the rules are free text an
  // admin typed, so they must show exactly as typed and never run as markup.
  function renderRules(rules) {
    const list = $('#rulesList');
    list.replaceChildren(...rules.map((rule) => {
      const li = document.createElement('li');
      li.textContent = rule;
      return li;
    }));
  }

  async function loadRules() {
    try {
      const { rules } = await api('/api/rules');
      state.rules = rules;
      renderRules(rules);
    } catch (e) {
      $('#rulesList').innerHTML = '<li class="rules-loading">Could not load the line rules right now.</li>';
    }
  }

  // ---------- Admin: session ----------
  async function refreshAdminSession() {
    try {
      const s = await api('/api/admin/session');
      state.isAdmin = s.isAdmin;
      state.adminConfigured = s.configured;
      $('#adminLoggedOut').classList.toggle('hidden', s.isAdmin);
      $('#adminLoggedIn').classList.toggle('hidden', !s.isAdmin);
      if (!s.configured) {
        $('#loginError').textContent = 'Admin login has not been configured on this server yet.';
        $('#loginError').classList.remove('hidden');
        $('#loginForm button[type="submit"]').disabled = true;
      }
      if (s.isAdmin) {
        loadLine();
      }
    } catch (e) {
      toast('Could not reach the server.', 'error');
    }
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('#loginError');
    errorEl.classList.add('hidden');
    const password = $('#adminPassword').value;
    try {
      await api('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      $('#adminPassword').value = '';
      toast('Logged in.', 'success');
      refreshAdminSession();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' });
    state.isAdmin = false;
    closeRulesEditor();
    refreshAdminSession();
    toast('Logged out.');
  });

  // ---------- Admin: line control ----------
  $('#lineStartForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = Number($('#lineStartInput').value || 0);
    const label = $('#lineLabelInput').value;
    try {
      await api('/api/line/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start, label }) });
      toast('Line started.', 'success');
      loadLine();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#lineQuickAdjust').addEventListener('click', async (e) => {
    const btn = e.target.closest('.adjust-btn');
    if (!btn) return;
    try {
      await api('/api/line', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: Number(btn.dataset.delta) }) });
      loadLine();
    } catch (err) { toast(err.message, 'error'); }
  });

  async function bulkAdjust(sign) {
    const amount = Number($('#lineBulkAmount').value || 1);
    try {
      await api('/api/line', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: sign * amount }) });
      loadLine();
    } catch (err) { toast(err.message, 'error'); }
  }
  $('#lineBulkAdd').addEventListener('click', () => bulkAdjust(1));
  $('#lineBulkRemove').addEventListener('click', () => bulkAdjust(-1));

  $('#lineSetBtn').addEventListener('click', async () => {
    const raw = $('#lineSetInput').value;
    if (raw === '') { toast('Enter a count first.', 'error'); return; }
    const count = Number(raw);
    if (!Number.isFinite(count) || count < 0) { toast('Enter a valid count.', 'error'); return; }
    try {
      await api('/api/line/set', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count }) });
      $('#lineSetInput').value = '';
      toast('Count updated.', 'success');
      loadLine();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#noMoreBandsBtn').addEventListener('click', async () => {
    if (!confirm('Mark bands as sold out? This shows "Last band was given out" to everyone checking the line — only do this once the wristbands actually run out.')) return;
    try {
      await api('/api/line/no-more-bands', { method: 'POST' });
      toast('Marked: last band given out.', 'success');
      loadLine();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#stopLineBtn').addEventListener('click', async () => {
    const label = (state.line && state.line.label) || 'this line';
    if (!confirm(`End ${label}? This can't be undone — students will see the line as closed.`)) return;
    try {
      await api('/api/line/stop', { method: 'POST' });
      toast('Line ended.');
      loadLine();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ---------- Admin: line rules editor ----------
  // Two deliberate speed bumps: a confirm before the editor opens (in case
  // "Edit Line Rules" was tapped by accident) and a stronger one before
  // saving, since whatever is saved goes live as the official rules.
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

  // Numbers each rule and disables Up on the first / Down on the last.
  function refreshRuleEditor() {
    const items = $all('.rule-edit-item', $('#rulesEditorList'));
    items.forEach((li, i) => {
      li.querySelector('.rule-edit-num').textContent = `Rule ${i + 1}`;
      li.querySelector('textarea').setAttribute('aria-label', `Rule ${i + 1}`);
      li.querySelector('[data-action="up"]').disabled = i === 0;
      li.querySelector('[data-action="down"]').disabled = i === items.length - 1;
    });
  }

  function editorRules() {
    return $all('#rulesEditorList textarea').map((t) => t.value.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function hasUnsavedRuleChanges() {
    return JSON.stringify(editorRules()) !== JSON.stringify(state.rules || []);
  }

  function openRulesEditor() {
    $('#rulesEditorList').replaceChildren(...(state.rules || []).map(ruleEditorItem));
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

  $('#editRulesBtn').addEventListener('click', () => {
    if (!confirm('Open the line rules editor?\n\nYou\'ll be able to change the official line rules shown on the home page.')) return;
    openRulesEditor();
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

  $('#cancelRulesBtn').addEventListener('click', () => {
    if (hasUnsavedRuleChanges() && !confirm('Discard your changes? The line rules will stay exactly as they are now.')) return;
    closeRulesEditor();
  });

  $('#saveRulesBtn').addEventListener('click', async () => {
    const rules = editorRules();
    if (!rules.length) { toast('Add at least one rule before saving.', 'error'); return; }
    if (!hasUnsavedRuleChanges()) { toast('No changes to save.'); closeRulesEditor(); return; }
    const warning = 'Publish these as the OFFICIAL line rules?\n\n'
      + `Exactly what you typed (${rules.length} rule${rules.length === 1 ? '' : 's'}) will appear on the Rowdy Reptiles home page for everyone to see, replacing the current rules.\n\n`
      + 'Double-check spelling and wording before you continue.';
    if (!confirm(warning)) return;
    try {
      const saved = await api('/api/rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) });
      state.rules = saved.rules;
      renderRules(saved.rules);
      closeRulesEditor();
      toast('Line rules updated.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // ---------- Init ----------
  async function init() {
    showTab(tabFromHash(location.hash) || DEFAULT_TAB, { push: false });
    await Promise.all([loadLine(), loadRules(), refreshAdminSession()]);
    setInterval(loadLine, 10000);
  }

  init();
})();
