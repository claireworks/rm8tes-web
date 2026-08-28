// Refuses to render this page inside somebody else's frame.
//
// This is the one page on the site whose entire job is to look trustworthy: a
// green banner, the word "Verified", a column of checkmarks. Framed under a
// lookalike domain, that real markup lends its credibility to a fake result,
// and an overlay can replace the verdict while leaving the rest on show. The
// marketing pages carry no such weight and are left framable.
//
// `Content-Security-Policy: frame-ancestors 'none'` is the correct fix and this
// is not a substitute for it -- a sandboxed frame can stop the escape below,
// and a determined attacker can simply serve their own copy of this page. But
// frame-ancestors is header-only (a <meta> CSP silently ignores it) and GitHub
// Pages cannot set headers on a custom domain, so until the domain sits behind
// a proxy that can, this raises the bar rather than leaving it on the floor.
//
// Loaded synchronously from <head>, before anything paints: an attacker must
// never get a rendered "Verified" to work with, even briefly.
(function () {
  if (window.self === window.top) return;

  // Hide first, ask questions later. Everything below this point is about
  // getting the reader somewhere safe, not about showing them the result.
  document.documentElement.style.display = 'none';

  try {
    window.top.location.replace(window.self.location.href);
  } catch (e) {
    // Cross-origin top navigation without a user gesture: blocked. Fall through
    // to the notice.
  }

  // If the escape worked this document is already being torn down and none of
  // the below is ever seen. If it did not, say so plainly rather than leaving a
  // blank page that looks like a broken site.
  document.addEventListener('DOMContentLoaded', function () {
    var wrap = document.createElement('div');
    wrap.className = 'frame-warning';

    var h = document.createElement('h1');
    h.textContent = 'Open this page directly';

    var p = document.createElement('p');
    p.textContent =
      'Something has embedded the rm8tes verification page inside another ' +
      'site, which means the result shown around it cannot be trusted. ' +
      'Check your record at the real address instead:';

    var p2 = document.createElement('p');
    var a = document.createElement('a');
    // Same document, opened at the top level. The record hash lives in the
    // fragment, so it survives and the check re-runs on arrival.
    a.href = window.self.location.href;
    a.target = '_top';
    a.rel = 'noopener';
    a.textContent = 'rm8tes.com/verify/';
    p2.append(a);

    wrap.append(h, p, p2);
    document.body.replaceChildren(wrap);
    document.documentElement.style.display = '';
  });
})();
