# Rowdy-Reptiles-Website-Prototype-Demo
A non-functioning version of the Rowdy Reptiles website, used to get the real site approved.

It's a fully static copy of the real site's front end with **no server**. The page code
(`app.js`, `admin.js`, `styles.css`, `admin.css`) is the same as on the real site.
[`public/mock-api.js`](public/mock-api.js) stands in for the server: it answers every
`/api/...` request inside the browser, with the same routes and responses. Everything an
admin changes is saved to your browser's `localStorage` only, and nothing is sent
anywhere.

## Try it
- **Public page:** the hero, the live line counter and the line rules.
- **Admin:** use the button in the footer (`admin.html`). The demo password is
  **`rowdydemo`**, also shown on the login form.
- **Things to try:**
  - start a line and type an extra count;
  - watch the simulated Google Sheet add a group every ~20 seconds;
  - press No More Bands;
  - switch to the stadium count (orange) and type the admitted total;
  - press Capacity Reached;
  - undo either flag (two confirmations);
  - edit the line rules.

  Open the public page in a second tab to see changes there. Both tabs
  share this browser's storage.

Differences from the real site, on purpose:
- The real site has no Admin link; its dashboard lives at a secret URL behind a
  hashed password.
- The real site reads the base count from the club's private Google Sheet. Here the
  sheet is simulated.
- The real site keeps state on its server, so every visitor sees the same thing.

## Preview locally
No build step: `public/` is the deployable site as-is.
```
npm run serve
```

## Deploy to GitHub Pages
Push to `main`, and the included workflow
([`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)) publishes
`public/` to GitHub Pages automatically. In the repo's Settings → Pages, set the source
to "GitHub Actions" once.

## Scripts
| Command | What it does |
| --- | --- |
| `npm run serve` | Serves `public/` locally. |
| `npm run build-wordmark` | Rebuilds `public/logo-wordmark.png` from `Images/logo.png` (crop + resize). |
| `npm run generate-gator-skin` | Regenerates the hero texture `public/gator-skin.png`. |
