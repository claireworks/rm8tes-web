# rm8tes-web

Marketing + legal site for **rm8tes** — the app that helps UK renters protect
their tenancy deposit with move-in / move-out photo evidence, captured by the
whole household rather than one person: flatmates share a vault through a join
code, and an audit only seals once everybody agrees it is complete.

Plain static HTML/CSS, no build step. Designed to be hosted on GitHub Pages.

## Structure

```
index.html        landing page
how-to/           How to use rm8tes — the illustrated guide
privacy/          Privacy Policy
terms/            Terms & Conditions
support/          Support & contact
assets/
  style.css       shared styles (palette + type from the app)
  fonts/          VT323 + Press Start 2P (OFL — see assets/fonts/NOTICE)
  img/            logo, favicon, social-preview image
  img/guide/      screenshots for the how-to page (see below)
.nojekyll         serve files as-is (no Jekyll processing)
```

## Regenerating the guide screenshots

`assets/img/guide/` is not hand-cropped from a handset. Every file is the real
app, rendered headlessly by `test/screenshots.dart` in the **app** repo, which
drives the same fake auth/camera/storage layer the widget tests use and writes
one PNG per screen at 430×932 @3×. Nothing is mocked up, so a screen and the
step describing it cannot quietly drift apart.

```sh
cd "../new rm8tes"
SHOT_DIR=/tmp/shots flutter test test/screenshots.dart

# down to display size, then lossless WebP (~40% smaller than the PNG,
# and pixel type does not survive a lossy pass)
cd /tmp/shots
for f in *.png; do
  ffmpeg -i "$f" -vf "scale=620:-1" "/tmp/${f%.png}-620.png"
  cwebp -lossless -z 9 "/tmp/${f%.png}-620.png" -o "…/assets/img/guide/NN-name.webp"
done
```

Filenames on the page are numbered by step rather than by source screen, so
check `how-to/index.html` for the mapping before overwriting anything. One
image — `15-gps-detail.webp` — is a crop of the capture preview's metadata
strip: the headless camera returns a 1×1 pixel, so the photo above that strip
is blank and must stay out of frame.
