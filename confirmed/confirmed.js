// Narrows the wording on the confirmation landing page to whichever kind of
// link brought the reader here.
//
// Kept in a file rather than inline so index.html can declare
// `script-src 'self'` without 'unsafe-inline'. The sign-up case is the default
// markup, so the page still reads correctly if this never runs.
(function () {
  // Supabase has already verified the link server-side before redirecting
  // here. It reports what happened either in the fragment (implicit flow, and
  // all error cases) or the query string (PKCE), so read both.
  var params = new URLSearchParams(
    window.location.hash.slice(1) || window.location.search.slice(1)
  );

  var COPY = {
    recovery: {
      status: 'Verified',
      headline: 'Password reset link verified',
      // Reset is self-service in the app now: links carry a deep link back to
      // it, so this page is no longer where recovery lands. It is still
      // reached by links emailed before that shipped, and those cannot be
      // redeemed here — the only way forward is a fresh link from a current
      // build, so that is what this says.
      body: '<p>We&rsquo;ve confirmed it&rsquo;s you, but this link is from an older version of the app and can&rsquo;t set your password here.</p><p>Update <strong>rm8tes</strong> on your phone, tap <strong>Forgot password?</strong> on the log-in screen, and the new link will open straight into the app. Still stuck? Email <a href="mailto:rm8tes@gmail.com">rm8tes@gmail.com</a> from this address.</p>'
    },
    email_change: {
      status: 'Updated',
      headline: 'Your email address is updated',
      body: '<p>Your rm8tes account now uses this address. Sign in with it next time.</p><p>You can close this tab.</p>'
    },
    invite: {
      status: 'Accepted',
      headline: 'Your invite is accepted',
      body: '<p>Welcome to the rm8tes beta. Open the <strong>rm8tes</strong> app on your phone to finish setting up your account.</p>'
    }
  };
  COPY.email = COPY.email_change;  // older links use the short type name
  COPY.magiclink = COPY.invite;

  var ERRORS = {
    otp_expired: {
      status: 'Link expired',
      headline: 'This link has expired',
      body: '<p>Confirmation links are only valid for a short window. Open the <strong>rm8tes</strong> app and ask for a new one &mdash; it&rsquo;ll arrive in a moment.</p>'
    }
  };
  var GENERIC_ERROR = {
    status: 'Not accepted',
    headline: 'This link didn&rsquo;t work',
    body: '<p>It may have expired, or already been used. Open the <strong>rm8tes</strong> app and request a new link.</p><p>If it keeps happening, email <a href="mailto:rm8tes@gmail.com">rm8tes@gmail.com</a>.</p>'
  };

  // Own properties only. A plain lookup also resolves everything on
  // Object.prototype, so /confirmed/#type=constructor found a truthy value,
  // skipped the fallback below, and wrote "undefined" into the headline.
  function lookup(table, key) {
    return key !== null && Object.prototype.hasOwnProperty.call(table, key)
      ? table[key]
      : null;
  }

  var state;
  if (params.get('error') || params.get('error_code')) {
    // Only ever render our own copy, never the error_description off the URL —
    // that text is attacker-controllable and reads like a system fault anyway.
    state = lookup(ERRORS, params.get('error_code')) || GENERIC_ERROR;
    document.getElementById('card').classList.add('is-error');
  } else {
    state = lookup(COPY, params.get('type'));
  }

  if (state) {
    var headline = document.getElementById('headline');
    document.getElementById('status').textContent = state.status;
    headline.innerHTML = state.headline;
    document.getElementById('body').innerHTML = state.body;
    document.title = headline.textContent + ' — rm8tes';
  }

  // Strip the fragment: it can carry access and refresh tokens, and there is
  // no reason to leave those sitting in browser history or in a shared URL.
  // (A future deep-link handoff would need to read them *before* this runs.)
  if (window.history.replaceState && window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname);
  }
})();
