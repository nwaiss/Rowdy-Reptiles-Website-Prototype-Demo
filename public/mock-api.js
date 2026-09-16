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
  };

  // Public demo credential — this is a static prototype with no real
  // backend, so there is nothing sensitive behind it. Shown on the admin
  // tab itself so reviewers can log in without asking.
  const DEMO_ADMIN_PASSWORD = 'rowdydemo';

  const MAX_LINE_COUNT = 2000;
  const MAX_LINE_DELTA = 500;

  const DEFAULT_LINE = Object.freeze({
    active: true,
    count: 82,
    label: 'vs FSU',
    bandsOut: false,
    updatedAt: new Date().toISOString(),
  });

  const CONFIG = Object.freeze({
    // Mirrors the real site's current (not-yet-configured) values: donate
    // and GroupMe links are blank until the officers set them up, so the
    // demo shows the same "coming soon" state a live visitor sees today.
    donateUrl: null,
    groupmeUrl: null,
    instagramProfileUrl: 'https://www.instagram.com/ufrowdies/',
  });

  // Square, brand-colored placeholder tiles (inline SVG data URIs) stand
  // in for real Instagram photos so the Socials tab has something to show
  // without any external image requests — keeps the demo fully static and
  // offline-capable.
  // Simple stroke-based stick-figure line art, one per drawing name, each
  // illustrating its paired caption below instead of just naming it.
  const STICK_FIGURE_DRAWINGS = {
    // "Gate 3 was ROWDY tonight" — a figure doing the Gator Chomp, arms
    // meeting at a hinge point and opening into a toothed jaw.
    gatorChomp: (stroke) => `
      <g fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="270" cy="170" r="48"/>
        <line x1="270" y1="218" x2="270" y2="390"/>
        <path d="M270 400 L225 510"/>
        <path d="M270 400 L315 510"/>
        <path d="M270 260 L400 300"/>
        <path d="M270 280 L400 300"/>
        <path d="M400 300 L480 240"/>
        <path d="M400 300 L480 360"/>
        <path d="M430 275 L440 288 M450 262 L460 275 M430 325 L440 312 M450 338 L460 325" stroke-width="6"/>
      </g>`,
    // "Line started at 4pm... get here early next time" — a figure racing
    // a clock toward the gate, with motion lines trailing behind.
    raceToGate: (stroke) => `
      <g fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="150" cy="150" r="60"/>
        <path d="M150 110 L150 150 L180 165" stroke-width="8"/>
        <circle cx="370" cy="255" r="42"/>
        <path d="M370 295 L335 375 L385 425"/>
        <path d="M370 295 L420 355 L450 335"/>
        <path d="M380 315 L320 295"/>
        <path d="M380 315 L440 275"/>
        <path d="M245 250 L290 250 M235 292 L280 292 M250 334 L295 334" stroke-width="6" opacity="0.6"/>
      </g>`,
    // "Section looking loud and proud... Chomp on!" — a figure jumping and
    // shouting, with sound-wave lines and a dashed jump line underfoot.
    rowdyCheer: (stroke) => `
      <g fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="300" cy="220" r="50"/>
        <line x1="300" y1="270" x2="300" y2="400"/>
        <path d="M300 300 L230 200"/>
        <path d="M300 300 L370 200"/>
        <path d="M300 400 L255 470 L270 520"/>
        <path d="M300 400 L345 470 L330 520"/>
        <path d="M380 220 Q410 220 410 250" stroke-width="6" opacity="0.7"/>
        <path d="M400 200 Q445 200 445 250" stroke-width="6" opacity="0.5"/>
        <path d="M200 545 Q300 565 400 545" stroke-width="6" stroke-dasharray="4 14" opacity="0.5"/>
        <circle cx="300" cy="236" r="9" fill="${stroke}" stroke="none"/>
      </g>`,
    // "Game day fits check" — a figure posing in sunglasses.
    fitsCheck: (stroke) => `
      <g fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="300" cy="190" r="55"/>
        <rect x="253" y="173" width="38" height="20" rx="6"/>
        <rect x="309" y="173" width="38" height="20" rx="6"/>
        <line x1="291" y1="183" x2="309" y2="183" stroke-width="7"/>
        <line x1="300" y1="245" x2="300" y2="400"/>
        <path d="M300 280 L362 300 L348 348"/>
        <path d="M300 280 L238 330"/>
        <path d="M300 400 L253 500"/>
        <path d="M300 400 L340 500"/>
        <path d="M120 530 Q300 480 480 530" stroke-width="6" stroke-dasharray="4 16" opacity="0.55"/>
      </g>`,
    // "Thanks for sticking out the rain delay" — two figures sharing an
    // umbrella, with rain overhead and a heart for the thank-you.
    rainDelay: (stroke) => `
      <g fill="none" stroke="${stroke}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
        <line x1="110" y1="70" x2="95" y2="120"/>
        <line x1="170" y1="55" x2="155" y2="105"/>
        <line x1="430" y1="55" x2="415" y2="105"/>
        <line x1="490" y1="70" x2="475" y2="120"/>
        <path d="M160 220 A140 105 0 0 1 440 220 Z"/>
        <path d="M230 222 L230 198 M300 224 L300 193 M370 222 L370 198" stroke-width="5"/>
        <circle cx="245" cy="310" r="32"/>
        <line x1="245" y1="342" x2="245" y2="450"/>
        <path d="M245 370 L202 402"/>
        <path d="M245 370 L280 400"/>
        <path d="M245 450 L215 525"/>
        <path d="M245 450 L270 525"/>
        <circle cx="355" cy="310" r="32"/>
        <line x1="355" y1="342" x2="355" y2="450"/>
        <path d="M355 370 L398 402"/>
        <path d="M355 370 L320 400"/>
        <path d="M355 450 L385 525"/>
        <path d="M355 450 L330 525"/>
        <path d="M285 128 c0-18 26-18 26 0 c0-18 26-18 26 0 c0 20-26 37-26 37 c0 0-26-17-26-37 Z" fill="${stroke}" stroke="none"/>
      </g>`,
    // "New shirts coming soon" — a figure holding up a fresh tee.
    newShirt: (stroke) => `
      <g fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="225" cy="235" r="42"/>
        <line x1="225" y1="277" x2="225" y2="440"/>
        <path d="M225 305 L165 255"/>
        <path d="M225 305 L290 235"/>
        <path d="M225 440 L183 535"/>
        <path d="M225 440 L267 535"/>
        <path d="M300 175 L345 175 L370 205 L395 175 L440 175 L465 218 L430 242 L430 330 L310 330 L310 242 L275 218 Z"/>
        <path d="M470 120 l8 20 l20 8 l-20 8 l-8 20 l-8 -20 l-20 -8 l20 -8 z" fill="${stroke}" stroke="none"/>
        <path d="M418 268 l5 13 l13 5 l-13 5 l-5 13 l-5 -13 l-13 -5 l13 -5 z" fill="${stroke}" stroke="none"/>
      </g>`,
  };
  function stickFigureTile(bg, stroke, drawing) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
      <rect width="600" height="600" fill="${bg}"/>
      ${STICK_FIGURE_DRAWINGS[drawing](stroke)}
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  // Each post: a stick-figure drawing tile illustrating its caption below.
  const IG_POST_ART = [
    { bg: '#1e40c4', stroke: '#ffffff', drawing: 'gatorChomp' },
    { bg: '#ef6a2c', stroke: '#1e40c4', drawing: 'raceToGate' },
    { bg: '#1e40c4', stroke: '#ffb020', drawing: 'rowdyCheer' },
    { bg: '#ffb020', stroke: '#1e40c4', drawing: 'fitsCheck' },
    { bg: '#0a1442', stroke: '#ef6a2c', drawing: 'rainDelay' },
    { bg: '#ef6a2c', stroke: '#ffffff', drawing: 'newShirt' },
  ];

  const IG_CAPTIONS = [
    'Gate 3 was ROWDY tonight. Thanks for showing up early, reptiles 🐊',
    'Line started at 4pm and we still ran out of bands. Get here early next time!',
    'Section looking loud and proud as always. Chomp on!',
    'Game day fits check. See y’all at the next one.',
    'Huge thanks to everyone who stuck it out through the rain delay.',
    'New shirts coming soon — follow along for the drop.',
  ];

  function buildInstagramPosts() {
    const now = Date.now();
    return IG_POST_ART.map((art, i) => {
      const image = stickFigureTile(art.bg, art.stroke, art.drawing);
      return {
        id: `demo-${i + 1}`,
        caption: IG_CAPTIONS[i] || '',
        media_type: 'IMAGE',
        media_url: image,
        thumbnail_url: image,
        permalink: CONFIG.instagramProfileUrl,
        timestamp: new Date(now - i * 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
    });
  }
  const INSTAGRAM_POSTS = buildInstagramPosts();

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
    'GET /api/config': async () => CONFIG,

    'GET /api/instagram': async () => ({ data: INSTAGRAM_POSTS }),

    'GET /api/line': async () => readLine(),

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
