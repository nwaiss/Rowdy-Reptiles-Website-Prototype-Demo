/**
 * @file Demo-only stand-in for the real Rowdy Reptiles server.
 *
 * The real site (github.com/nwaiss/Rowdy-Reptiles-Website) is a Node/Express
 * server. This prototype is static (GitHub Pages, or any local file server),
 * so this script replaces `window.fetch` for every `/api/...` request and
 * answers it in the browser, with the same routes, rules, error messages and
 * response shapes as the real server. Because of that, the page code
 * (app.js, admin.js, styles.css, admin.css) is copied from the real site
 * unchanged.
 *
 * What's different from the real site, on purpose:
 *   - State lives in this browser's localStorage, not on a server, so changes
 *     show in other tabs of the same browser but not on other devices.
 *   - The admin "login" is a demo password checked in the browser
 *     (rowdydemo). There's no real security here, and nothing to protect.
 *   - The Google Sheet is simulated: once a line starts, a group of 1–4
 *     people "joins" every 20 seconds (see simulatedSheet below).
 *   - GET /api/line always returns the detailed admin view. The public page
 *     ignores the extra fields.
 *
 * Keep this in sync with the real server's lib/line-store.js and
 * lib/admin-router.js when features change there.
 */
(function () {
  'use strict';

  // =====================================================================
  // Storage
  // =====================================================================

  const STORAGE = {
    line: 'rr_demo_line_v2', // v2: line + stadium modes (v1 had a single `count`)
    admin: 'rr_demo_admin_v1',
    rules: 'rr_demo_rules_v1',
  };

  /** Public demo credential, also shown on the login form. */
  const DEMO_ADMIN_PASSWORD = 'rowdydemo';

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) ?? fallback);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    // Private browsing or full storage: the demo still works for this page view.
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    return value;
  }

  // =====================================================================
  // Rules (mirrors lib/rules-store.js)
  // =====================================================================

  const MAX_RULES = 30;
  const MAX_RULE_LENGTH = 500;
  const DEFAULT_RULES = Object.freeze([
    'Line begins at Gate 3. Student tickets/bands are not accepted at any other gates.',
    'Limit of 2 bands per person. 500–700 bands are distributed on a game-by-game basis. Bands guarantee entry, but not lower bowl seating.',
    'Half of your party must remain in line at all times. Failure to do so during line checks may result in being removed from the line.',
    'Bands are numbered, and entry is granted in numerical order.',
    'Reselling of bands is strictly prohibited.',
    'All camping equipment (chairs, tables, TVs, backpacks) must be removed from the line 2 hours before gates open.',
    'Line checks will be administered in a timely manner. Final line checks will take place 1 hour before doors open.',
    'Your whole group must be present for the final line check. Failure to do so will result in your group losing its spot in line.',
  ]);

  function readRules() {
    const saved = readJson(STORAGE.rules, null);
    return Array.isArray(saved) && saved.length ? saved : [...DEFAULT_RULES];
  }

  // =====================================================================
  // Line (mirrors lib/line-store.js)
  // =====================================================================

  const LIMITS = { MAX_EXTRA: 2000, MAX_DELTA: 500, MAX_ADMITTED: 100000, MAX_LABEL_LENGTH: 80 };
  const MODES = ['line', 'admitted'];

  /** An error the server would answer with this status and message. */
  class ApiError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
  }

  function parseWholeNumber(raw) {
    const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
    if (raw === undefined || raw === null || !Number.isFinite(n)) throw new ApiError('Enter a valid number.');
    return Math.trunc(n);
  }

  function parseExtra(raw) { return clamp(parseWholeNumber(raw), -LIMITS.MAX_EXTRA, LIMITS.MAX_EXTRA); }

  function parseAdmitted(raw) {
    const n = parseWholeNumber(raw);
    if (n < 0) throw new ApiError('The admitted count can\'t be negative.');
    return Math.min(n, LIMITS.MAX_ADMITTED);
  }

  /** Current line state, with defaults for anything missing. */
  function readLine() {
    const saved = readJson(STORAGE.line, {});
    return {
      active: saved.active === true,
      mode: MODES.includes(saved.mode) ? saved.mode : 'line',
      label: typeof saved.label === 'string' ? saved.label : '',
      bandsOut: saved.bandsOut === true,
      extra: Number.isFinite(saved.extra) ? saved.extra : 0,
      admitted: Number.isFinite(saved.admitted) ? saved.admitted : 0,
      capacityReached: saved.capacityReached === true,
      startedAt: typeof saved.startedAt === 'string' ? saved.startedAt : null, // demo only: drives the simulated sheet
      updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : new Date().toISOString(),
    };
  }

  function saveLine(changes) {
    return writeJson(STORAGE.line, { ...readLine(), ...changes, updatedAt: new Date().toISOString() });
  }

  function requireMode(line, mode) {
    if (!line.active) throw new ApiError('Start a line first.');
    if (line.mode !== mode) {
      throw new ApiError(mode === 'line' ? 'Switch back to the line count first.' : 'Switch to the stadium count first.');
    }
  }

  // =====================================================================
  // Simulated Google Sheet (demo only)
  // =====================================================================
  // The real server reads Count!B2 from the club's sheet every 5 seconds.
  // Here, a group "joins" every GROUP_EVERY_MS after the line starts. The
  // total is worked out from the start time, so it's the same in every tab
  // and survives reloads.

  const GROUP_EVERY_MS = 20000;
  const MAX_GROUPS = 150;

  /** A repeatable group size of 1–4 for the i-th group. */
  function groupSize(i) {
    // Small integer hash (murmur-style mixing) so sizes look random but
    // come out the same on every reload and in every tab.
    let h = Math.imul(i + 1, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return 1 + ((h >>> 0) % 4);
  }

  function simulatedSheet(line) {
    const readAt = new Date().toISOString();
    if (!line.active || !line.startedAt) return { configured: true, value: 0, readAt, changedAt: null, error: null };
    const started = Date.parse(line.startedAt);
    const groups = clamp(Math.floor((Date.now() - started) / GROUP_EVERY_MS), 0, MAX_GROUPS);
    let value = 0;
    for (let i = 0; i < groups; i++) value += groupSize(i);
    const changedAt = groups ? new Date(started + groups * GROUP_EVERY_MS).toISOString() : null;
    return { configured: true, value, readAt, changedAt, error: null };
  }

  // =====================================================================
  // Views (mirror toPublicView / toAdminView)
  // =====================================================================

  function publicView(line, sheet) {
    if (!line.active) {
      return { active: false, mode: 'line', count: 0, label: '', bandsOut: false, capacityReached: false, updatedAt: null };
    }
    const shared = { active: true, mode: line.mode, label: line.label, bandsOut: line.bandsOut, capacityReached: line.capacityReached };
    if (line.mode === 'admitted') return { ...shared, count: line.admitted, updatedAt: line.updatedAt };
    const updatedAt = sheet.changedAt && sheet.changedAt > line.updatedAt ? sheet.changedAt : line.updatedAt;
    return { ...shared, count: Math.max(0, (sheet.value ?? 0) + line.extra), updatedAt };
  }

  function adminView() {
    const line = readLine();
    const sheet = simulatedSheet(line);
    return {
      ...publicView(line, sheet),
      base: sheet.value ?? 0,
      extra: line.extra,
      admitted: line.admitted,
      sheet: { configured: true, ok: true, error: null, readAt: sheet.readAt },
    };
  }

  // =====================================================================
  // Routes (same paths, methods and messages as the real server)
  // =====================================================================

  function isAdmin() { return readJson(STORAGE.admin, false) === true; }

  function requireAdmin() {
    if (!isAdmin()) throw new ApiError('Your session has ended. Log in again.', 401);
  }

  /** Wraps an admin-only handler. */
  const admin = (handler) => (body) => { requireAdmin(); return handler(body); };

  /** Keyed by "METHOD path", where path is what follows /api/. */
  const ROUTES = {
    // Public
    'GET line': () => adminView(),
    'GET rules': () => ({ rules: readRules() }),

    // Session
    'GET session': () => ({ isAdmin: isAdmin() }),
    'POST login': (body) => {
      if (typeof body.password !== 'string' || body.password !== DEMO_ADMIN_PASSWORD) throw new ApiError('Incorrect password.', 401);
      writeJson(STORAGE.admin, true);
      return { ok: true };
    },
    'POST logout': () => {
      try { localStorage.removeItem(STORAGE.admin); } catch { /* ignore */ }
      return { ok: true };
    },

    // Line
    'POST line/start': admin((body) => {
      if (readLine().active) throw new ApiError('A line is already live. End it before starting a new one.');
      const extra = body.extra === undefined || body.extra === '' ? 0 : parseExtra(body.extra);
      const now = new Date().toISOString();
      saveLine({
        active: true, mode: 'line', label: cleanText(body.label, LIMITS.MAX_LABEL_LENGTH), extra,
        bandsOut: false, admitted: 0, capacityReached: false, startedAt: now,
      });
      return adminView();
    }),
    'POST line/stop': admin(() => {
      if (readLine().active) saveLine({ active: false });
      return adminView();
    }),
    'POST line/no-more-bands': admin(() => { requireMode(readLine(), 'line'); saveLine({ bandsOut: true }); return adminView(); }),
    'DELETE line/no-more-bands': admin(() => { requireMode(readLine(), 'line'); saveLine({ bandsOut: false }); return adminView(); }),
    'PATCH line/extra': admin((body) => {
      const line = readLine();
      requireMode(line, 'line');
      const step = clamp(Math.trunc(Number(body.delta) || 0), -LIMITS.MAX_DELTA, LIMITS.MAX_DELTA);
      saveLine({ extra: clamp(line.extra + step, -LIMITS.MAX_EXTRA, LIMITS.MAX_EXTRA) });
      return adminView();
    }),
    'PUT line/extra': admin((body) => { requireMode(readLine(), 'line'); saveLine({ extra: parseExtra(body.extra) }); return adminView(); }),
    'POST line/mode': admin((body) => {
      const line = readLine();
      if (!line.active) throw new ApiError('Start a line first.');
      if (!MODES.includes(body.mode)) throw new ApiError('Unknown mode.');
      if (line.mode !== body.mode) saveLine({ mode: body.mode });
      return adminView();
    }),
    'PUT line/admitted': admin((body) => { requireMode(readLine(), 'admitted'); saveLine({ admitted: parseAdmitted(body.admitted) }); return adminView(); }),
    'POST line/capacity-reached': admin(() => { requireMode(readLine(), 'admitted'); saveLine({ capacityReached: true }); return adminView(); }),
    'DELETE line/capacity-reached': admin(() => { requireMode(readLine(), 'admitted'); saveLine({ capacityReached: false }); return adminView(); }),

    // Rules
    'PUT rules': admin((body) => {
      if (!Array.isArray(body.rules)) throw new ApiError('A list of rules is required.');
      const rules = body.rules.map((r) => cleanText(r, MAX_RULE_LENGTH)).filter(Boolean);
      if (!rules.length) throw new ApiError('Add at least one rule before saving.');
      if (rules.length > MAX_RULES) throw new ApiError(`There can be at most ${MAX_RULES} rules.`);
      writeJson(STORAGE.rules, rules);
      return { rules };
    }),
  };

  // =====================================================================
  // fetch() shim
  // =====================================================================

  const realFetch = window.fetch.bind(window);
  const jsonResponse = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.fetch = async function demoFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const match = url.pathname.match(/\/api\/(.+)$/);
    if (!match) return realFetch(input, init);

    await delay(120 + Math.random() * 180); // feels like a real network round trip
    const method = (init.method || 'GET').toUpperCase();
    const handler = ROUTES[`${method} ${match[1]}`];
    if (!handler) return jsonResponse({ error: 'Not found.' }, 404);

    let body = {};
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { return jsonResponse({ error: 'That request was not valid.' }, 400); }
    }
    try {
      return jsonResponse(handler(body || {}), 200);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Something went wrong.' }, err.status || 500);
    }
  };

  // =====================================================================
  // Old links
  // =====================================================================
  // Earlier versions of this demo used hash routes. Send old bookmarks to
  // the right place: #admin → admin.html, #line / #line-rules → their section.
  const hash = location.hash.replace(/^#/, '');
  const onAdminPage = /admin\.html$/.test(location.pathname);
  if (!onAdminPage && hash === 'admin') location.replace('admin.html');
  const SECTIONS = { line: 'lineCounter', 'line-rules': 'lineRules' };
  if (!onAdminPage && SECTIONS[hash]) location.replace(`#${SECTIONS[hash]}`);
})();
