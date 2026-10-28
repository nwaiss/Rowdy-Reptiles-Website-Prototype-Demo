/**
 * @file Demo only: the "Simulated Google Sheet" panel at the bottom of the
 * admin dashboard.
 *
 * On the real site the line count's base comes from the club's Google
 * Sheet, which students fill in through a Google Form. This demo has no
 * sheet, so this panel lets a reviewer set how many students are "on the
 * sheet", and optionally keep adding a random group every 20 seconds. It
 * talks to mock-api.js's demo-only routes:
 *
 *   GET /api/demo/sheet        { active, value, auto, groupEverySeconds }
 *   PUT /api/demo/sheet        { value }  sets the number of students
 *   PUT /api/demo/sheet/auto   { auto }   turns the automatic groups on/off
 *
 * Kept separate from admin.js on purpose: admin.js is copied unchanged from
 * the real site, and this file has no counterpart there.
 */
(function () {
  'use strict';

  /** How often the panel's number refreshes while it's on screen. */
  const POLL_MS = 3000;

  const els = {
    panel: document.getElementById('demoSheetPanel'),
    value: document.getElementById('demoSheetValue'),
    form: document.getElementById('demoSheetForm'),
    input: document.getElementById('demoSheetInput'),
    auto: document.getElementById('demoSheetAuto'),
    idle: document.getElementById('demoSheetIdle'),
  };

  /** Same look as the dashboard's own toasts (one at a time). */
  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = `toast ${kind || ''}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = message;
    document.getElementById('toasts').replaceChildren(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, kind === 'error' ? 5000 : 3000);
  }

  async function api(path, method, body) {
    const res = await fetch(path, {
      method: method || 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function render(sim) {
    els.value.textContent = sim.active ? sim.value : '—';
    els.auto.checked = sim.auto;
    els.input.disabled = !sim.active;
    els.form.querySelector('button').disabled = !sim.active;
    els.auto.disabled = !sim.active;
    els.idle.classList.toggle('hidden', sim.active);
  }

  /** The panel is inside the logged-in dashboard, so it's only "on screen" then. */
  const onScreen = () => !document.hidden && els.panel.offsetParent !== null;

  async function refresh() {
    if (!onScreen()) return;
    try { render(await api('api/demo/sheet')); } catch { /* logged out, or next poll retries */ }
  }

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = els.form.querySelector('button');
    button.disabled = true;
    try {
      render(await api('api/demo/sheet', 'PUT', { value: els.input.value }));
      els.input.value = '';
      toast('Simulated sheet updated. The dashboard count catches up within 5 seconds.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = els.input.disabled; // stays off if no line is live
    }
  });

  els.auto.addEventListener('change', async () => {
    try {
      render(await api('api/demo/sheet/auto', 'PUT', { auto: els.auto.checked }));
      toast(els.auto.checked ? 'A random group will join every 20 seconds.' : 'Automatic groups paused. The count holds steady.', 'success');
    } catch (err) {
      els.auto.checked = !els.auto.checked;
      toast(err.message, 'error');
    }
  });

  // Logging in, starting a line, or ending one changes what the panel should
  // show. Clicks anywhere on the dashboard trigger a quick re-check, on top
  // of the regular refresh.
  document.addEventListener('click', () => setTimeout(refresh, 600));
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, POLL_MS);
  refresh();
})();
