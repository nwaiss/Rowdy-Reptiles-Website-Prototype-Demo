# Rowdy-Reptiles-Website-Prototype-Demo
A non functioning version of the Rowdy Reptiles Website to help the original website get approval.

This is a fully static copy of the real site's frontend (`public/`) with no backend.
Everywhere the real site talks to its Express server, this build talks to
[`public/mock-api.js`](public/mock-api.js) instead — same request paths, same response
shapes, so the UI looks and behaves the same. "Write" actions (admin login, starting/
adjusting/ending the line) persist to `localStorage` in your browser only; nothing is
sent anywhere.

- Admin tab demo password: `rowdydemo` (shown on the login form itself)
- Instagram feed: placeholder tiles, since there's no real Instagram token here

## Preview locally
No build step — `public/` is the deployable site as-is.
```
npm run serve
```

## Deploy to GitHub Pages
Push to `main` and the included workflow ([`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml))
publishes `public/` to GitHub Pages automatically. In the repo's Settings → Pages,
set the source to "GitHub Actions" once.
