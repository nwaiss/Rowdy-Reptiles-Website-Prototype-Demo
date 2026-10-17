// Demo-only replacement for the real Rowdy Reptiles backend. Every request
// app.js used to send to the Express server is intercepted here instead —
// same paths, same methods, same response/error shapes — so the rest of
// app.js needed no changes beyond swapping fetch() for this. Nothing here
// ever leaves the browser: "writes" persist to localStorage only, and
// there is no real authentication behind the demo admin login.
(function (global) {
  'use strict';

  const STORAGE = {
    line: 'rr_demo_line_v1',
    admin: 'rr_demo_admin_v1',
    rules: 'rr_demo_rules_v1',
  };

  // Public demo credential — this is a static prototype with no real
  // backend, so there is nothing sensitive behind it. Shown on the admin
  // tab itself so reviewers can log in without asking.
  const DEMO_ADMIN_PASSWORD = 'rowdydemo';

  const MAX_LINE_COUNT = 2000;
  const MAX_LINE_DELTA = 500;

  // No line is live until an admin starts one from the dashboard — matches
  // how the real site behaves between games.
  const DEFAULT_LINE = Object.freeze({
    active: false,
    count: 0,
    label: '',
    bandsOut: false,
    updatedAt: new Date().toISOString(),
  });

  // The official line rules shown on the home page. Admins can replace them
  // from the dashboard's rule editor; these are what show until they do.
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
  const MAX_RULES = 30;
  const MAX_RULE_LENGTH = 500;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode / full storage: demo degrades to in-memory-only for this call */ }
    return value;
  }

  // Always a fresh, mutable object — route handlers below assign straight
  // onto what this returns, and DEFAULT_LINE itself is frozen.
  function readLine() { return { ...readJson(STORAGE.line, DEFAULT_LINE) }; }
  function writeLine(line) { return writeJson(STORAGE.line, line); }
  function readRules() {
    const rules = readJson(STORAGE.rules, DEFAULT_RULES);
    return Array.isArray(rules) && rules.length ? [...rules] : [...DEFAULT_RULES];
  }
  function readAdmin() { return readJson(STORAGE.admin, false) === true; }
  function writeAdmin(isAdmin) {
    if (isAdmin) return writeJson(STORAGE.admin, true);
    try { localStorage.removeItem(STORAGE.admin); } catch (e) { /* ignore */ }
    return false;
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function sanitizeText(value, maxLen) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
  }
  function apiError(message) { return new Error(message); }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  // Keyed "METHOD path" -> handler(body), mirroring server.js's routes
  // one-for-one (including its validation and error messages) so the UI
  // behaves identically with no backend behind it.
  const ROUTES = {
    'GET /api/line': async () => readLine(),

    'GET /api/rules': async () => ({ rules: readRules() }),

    'PUT /api/rules': async (body) => {
      if (!readAdmin()) throw apiError('Log in as an admin to change the line rules.');
      if (!Array.isArray(body.rules)) throw apiError('A list of rules is required.');
      const rules = body.rules.map((r) => sanitizeText(r, MAX_RULE_LENGTH)).filter(Boolean);
      if (!rules.length) throw apiError('Add at least one rule before saving.');
      if (rules.length > MAX_RULES) throw apiError(`There can be at most ${MAX_RULES} rules.`);
      writeJson(STORAGE.rules, rules);
      return { rules };
    },

    'GET /api/admin/session': async () => ({ isAdmin: readAdmin(), configured: true }),

    'POST /api/admin/login': async (body) => {
      const password = body && body.password;
      if (typeof password !== 'string' || password !== DEMO_ADMIN_PASSWORD) {
        throw apiError('Incorrect password.');
      }
      writeAdmin(true);
      return { ok: true };
    },

    'POST /api/admin/logout': async () => {
      writeAdmin(false);
      return { ok: true };
    },

    'POST /api/line/start': async (body) => {
      const existing = readLine();
      if (existing.active) throw apiError('A line is already live. End it before starting a new one.');
      const start = clamp(Number(body.start) || 0, 0, MAX_LINE_COUNT);
      const label = sanitizeText(body.label, 80);
      return writeLine({ active: true, count: start, label, bandsOut: false, updatedAt: new Date().toISOString() });
    },

    'POST /api/line/stop': async () => {
      const line = readLine();
      line.active = false;
      line.updatedAt = new Date().toISOString();
      return writeLine(line);
    },

    'POST /api/line/no-more-bands': async () => {
      const line = readLine();
      if (!line.active) throw apiError('Start a line counter first.');
      line.bandsOut = true;
      line.updatedAt = new Date().toISOString();
      return writeLine(line);
    },

    'PATCH /api/line': async (body) => {
      const line = readLine();
      if (!line.active) throw apiError('Start a line counter before adjusting it.');
      const delta = clamp(Math.trunc(Number(body.delta) || 0), -MAX_LINE_DELTA, MAX_LINE_DELTA);
      line.count = clamp(line.count + delta, 0, MAX_LINE_COUNT);
      line.updatedAt = new Date().toISOString();
      return writeLine(line);
    },

    'PATCH /api/line/set': async (body) => {
      const line = readLine();
      if (!line.active) throw apiError('Start a line counter before adjusting it.');
      if (body.count === undefined || Number.isNaN(Number(body.count))) {
        throw apiError('A valid count is required.');
      }
      line.count = clamp(Math.trunc(Number(body.count)), 0, MAX_LINE_COUNT);
      line.updatedAt = new Date().toISOString();
      return writeLine(line);
    },
  };

  async function mockApi(path, options) {
    const opts = options || {};
    const method = (opts.method || 'GET').toUpperCase();
    const handler = ROUTES[`${method} ${path}`];
    await delay(120 + Math.random() * 180); // simulated network latency
    if (!handler) throw apiError(`Request failed (404)`);
    let body = {};
    if (typeof opts.body === 'string') {
      try { body = JSON.parse(opts.body); } catch (e) { body = {}; }
    }
    return handler(body);
  }

  global.RowdyMockApi = { call: mockApi, DEMO_ADMIN_PASSWORD };
})(window);
