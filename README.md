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

All placeholders are filled and the DRAFT banners are gone — the legal pages are
publishable. The entity is **Roomates Ltd** (company number 16826260, registered
office 35 Welbeck Avenue, Tunbridge Wells, England, TN4 9BD), **trading as rm8tes**;
the registered name appears in the privacy policy, the terms, and the footer of every
page, and the brand stays "rm8tes" everywhere else. Contact address is rm8tes@gmail.com.

Two things to revisit as the product changes:

- **Backups.** The Privacy Policy promises deleted data leaves our backups within
  30 days. On the Free tier there are no automated backups, so this only binds any
  manual `db dump` exports we keep — don't sit on one longer than 30 days. On Pro,
  daily backups roll off after 7 days, comfortably inside the promise. Revisit the
  wording only if we ever add PITR with a window longer than 30 days.
- **Last updated dates.** Both legal pages say 24 July 2026; bump them whenever the
  substance changes.

## Deploy

GitHub Pages, served from the default branch. Add a `CNAME` file if/when a
custom domain is set up.
