/**
 * @file Script for the privacy and accessibility pages: fills in the club's
 * contact email (from /api/links) wherever the page has a spot for it. With
 * no email set, those spots stay hidden.
 */
(function () {
  'use strict';

  /** Points a link at the address and shows it (and its wrapper, if given). */
  function show(link, email, text, wrapper) {
    if (!link) return;
    link.href = `mailto:${email}`;
    link.textContent = text;
    (wrapper || link).classList.remove('hidden');
  }

  fetch('/api/links', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : {}))
    .then(({ email }) => {
      // The server only sends a plain address; this re-check keeps anything
      // else out of the mailto: link.
      if (typeof email !== 'string' || !/^[^\s@<>"]+@[^\s@<>"]+$/.test(email)) return;
      show(document.getElementById('footerContact'), email, `Contact: ${email}`);
      show(document.getElementById('contactEmail'), email, email, document.getElementById('contactSentence'));
    })
    .catch(() => { /* no contact shown; the rest of the page still works */ });
})();
