(function () {
  'use strict';

  const state = { isAdmin: false, adminConfigured: true, config: null };

  const VALID_TABS = ['about', 'socials', 'line-rules', 'line', 'donate', 'admin'];
  // Demo build: GitHub Pages has no server to rewrite clean paths like
  // /donate back to index.html, so routing lives in the hash instead
  // (#donate). Returns null for a hash that isn't one of ours (e.g. the
  // "Skip to content" link's #main) so the current tab is left alone.
  function tabFromHash(hash) {
    const clean = (hash || '').replace(/^#/, '');
    if (clean === '') return 'about';
    return VALID_TABS.includes(clean) ? clean : null;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

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
  // Every tab is a real, bookmarkable URL (e.g. /donate, /admin) handled
  // client-side via pushState; the server just serves index.html for any
  // of these paths so a hard refresh or shared link lands on the right tab.
  function showTab(name, opts) {
    const options = opts || {};
    if (!VALID_TABS.includes(name)) name = 'about';
    $all('.tab').forEach((t) => t.classList.add('hidden'));
    const target = document.getElementById(name);
    if (target) target.classList.remove('hidden');
    window.scrollTo(0, 0);
    $all('[data-tab]').forEach((b) => b.removeAttribute('aria-current'));
    $all(`[data-tab="${name}"]`).forEach((b) => b.setAttribute('aria-current', 'page'));
    $('#siteNav').classList.remove('open');
    $('#navToggle').setAttribute('aria-expanded', 'false');
    // The Line Counter is meant to be a one-glance display, not a page you
    // scroll — CSS uses this to size that tab to exactly fill the space
    // below the header (see #line.panel in styles.css) instead of scrolling.
    document.body.classList.toggle('no-scroll-tab', name === 'line');

    const hash = name === 'about' ? '#' : `#${name}`;
    if (options.push !== false && location.hash !== hash) {
      history.pushState(null, '', hash);
    }
    if (name === 'admin') refreshAdminSession();
  }

  // Keeps --header-h in sync with the header's real rendered height (it
  // changes at the mobile hamburger breakpoint, and reading the actual box
  // is more reliable than guessing a constant — especially with the
  // desktop `zoom` scale-up in play).
  function updateHeaderHeightVar() {
    const header = $('.site-header');
    // getBoundingClientRect(), not offsetHeight — under the desktop `zoom`
    // scale-up they disagree (offsetHeight reports the pre-zoom size), and
    // it's the real rendered height (matching how `vh` resolves) that this
    // needs to line up with.
    if (header) document.documentElement.style.setProperty('--header-h', `${header.getBoundingClientRect().height}px`);
  }
  window.addEventListener('resize', updateHeaderHeightVar);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateHeaderHeightVar);
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

  $('#navToggle').addEventListener('click', () => {
    const nav = $('#siteNav');
    const open = nav.classList.toggle('open');
    $('#navToggle').setAttribute('aria-expanded', String(open));
  });

  // ---------- Config-driven links (Instagram/GroupMe/Donate) ----------
  async function loadConfig() {
    try {
      state.config = await api('/api/config');
    } catch (e) {
      state.config = { donateUrl: null, groupmeUrl: null, instagramProfileUrl: 'https://www.instagram.com/ufrowdies/' };
    }
    renderSocialLinks();
    renderDonate();
  }

  // Pulls "@handle" out of an Instagram profile URL so it can be shown
  // without anyone having to click through first.
  function instagramHandle(url) {
    try {
      const handle = new URL(url).pathname.replace(/\//g, '');
      return handle ? `@${handle}` : null;
    } catch (e) {
      return null;
    }
  }

  function renderSocialLinks() {
    const cfg = state.config || {};
    const igUrl = cfg.instagramProfileUrl || 'https://www.instagram.com/ufrowdies/';
    const handle = instagramHandle(igUrl);
    const links = [`<a class="btn btn-accent btn-stacked" href="${escapeHtml(igUrl)}" target="_blank" rel="noopener noreferrer">
      <span class="btn-label">Follow on Instagram</span>
      ${handle ? `<span class="btn-sub">${escapeHtml(handle)}</span>` : ''}
    </a>`];
    if (cfg.groupmeUrl) {
      links.push(`<a class="btn btn-ghost" href="${escapeHtml(cfg.groupmeUrl)}" target="_blank" rel="noopener noreferrer">Join our GroupMe</a>`);
    }
    $('#socialLinks').innerHTML = links.join('');
  }

  function renderDonate() {
    const cfg = state.config || {};
    const card = $('#donateCard');
    if (cfg.donateUrl) {
      card.innerHTML = `<a class="btn btn-accent donate-btn" href="${escapeHtml(cfg.donateUrl)}" target="_blank" rel="noopener noreferrer">Donate Now</a>`;
    } else {
      card.innerHTML = `<p class="empty-state">Online giving is coming soon — check back once our accounts are set up!</p>`;
    }
  }

  // ---------- Instagram feed ----------
  async function loadInstagram() {
    const container = $('#instagramFeed');
    try {
      const j = await api('/api/instagram');
      if (j.data && j.data.length) {
        container.innerHTML = j.data.slice(0, 12).map((it) => `
          <div class="card">
            <a href="${escapeHtml(it.permalink)}" target="_blank" rel="noopener noreferrer">
              <img src="${escapeHtml(it.media_url || it.thumbnail_url)}" alt="Instagram post" loading="lazy">
            </a>
            <p>${escapeHtml(it.caption || '')}</p>
          </div>`).join('');
      } else {
        container.innerHTML = `<p class="empty-state">No live posts to show here yet — tap "Follow on Instagram" above.</p>`;
      }
      if (j.warning) container.innerHTML += `<p class="muted">${escapeHtml(j.warning)}</p>`;
    } catch (e) {
      container.innerHTML = `<p class="empty-state">Could not load Instagram right now.</p>`;
    }
  }

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

  // ---------- Init ----------
  async function init() {
    updateHeaderHeightVar();
    showTab(tabFromHash(location.hash) || 'about', { push: false });
    await Promise.all([loadInstagram(), loadLine(), loadConfig(), refreshAdminSession()]);
    updateHeaderHeightVar(); // logo/fonts may have finished loading and nudged the header's height
    setInterval(loadLine, 10000);
  }

  init();
})();
