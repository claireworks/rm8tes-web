# rm8tes-web

Marketing + legal site for **rm8tes** — the app that helps UK renters protect
their tenancy deposit with move-in / move-out photo evidence.

Plain static HTML/CSS, no build step. Designed to be hosted on GitHub Pages.

## Structure

```
index.html        landing page
privacy/          Privacy Policy
terms/            Terms & Conditions
support/          Support & contact
assets/
  style.css       shared styles (palette + type from the app)
  fonts/          VT323 + Press Start 2P (OFL — see assets/fonts/NOTICE)
  img/            logo, favicon, social-preview image
.nojekyll         serve files as-is (no Jekyll processing)
```

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Before going live

The Privacy Policy and Terms are drafts. Every highlighted `[PLACEHOLDER]`
(legal/company name, contact email, backup-retention window) must be filled in,
and the Support page needs a real contact address, before this site is published.

## Deploy

GitHub Pages, served from the default branch. Add a `CNAME` file if/when a
custom domain is set up.
