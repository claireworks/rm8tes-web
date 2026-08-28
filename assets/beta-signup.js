// The beta waitlist form on the home page.
//
// Kept in a file rather than inline so that index.html's Content-Security-Policy
// can say `script-src 'self' https://challenges.cloudflare.com` and mean it. An
// inline block would force 'unsafe-inline', which permits any injected <script>
// too and gives away most of what the policy is for.
//
// Loaded without defer, from the end of <body> and before the Turnstile tag, so
// the form exists when this runs and window.onTurnstileLoad exists when
// Cloudflare's script calls it.
(function(){
  // Posts to the beta-signup Edge Function, not to /rest/v1/beta_signups. The
  // table no longer accepts writes from the anon key: PostgREST cannot check a
  // CAPTCHA, so anything it will accept, a script will accept. The function
  // redeems the Turnstile token server-side and is the table's only writer.
  var SIGNUP_URL = "https://iqpmsuoxylfniayrntfm.supabase.co/functions/v1/beta-signup";

  // Sitekey of the widget registered to this site's hostname. Deliberately NOT
  // the app's key (0x4AAAAAAD-…): that one is registered to different hostnames
  // and runs in Invisible mode, which has no way to show a challenge. This
  // widget needs to be able to escalate to one.
  var TURNSTILE_SITE_KEY = "0x4AAAAAAD_UKN88645Pta0A";

  var form = document.getElementById("beta-form");
  var email = document.getElementById("beta-email");
  var honeypot = form.elements.company;
  var button = form.querySelector("button");
  var status = document.getElementById("beta-status");

  var widgetId = null;
  var awaitingToken = false;

  function setStatus(text, kind){
    status.textContent = text;
    status.className = "form-status" + (kind ? " " + kind : "");
  }

  // Called by the Turnstile script once it has loaded. Explicit rendering keeps
  // the sitekey in this config block rather than in the markup.
  window.onTurnstileLoad = function(){
    widgetId = window.turnstile.render("#beta-turnstile", {
      sitekey: TURNSTILE_SITE_KEY,
      // Stays out of the way until Cloudflare actually wants a challenge, and
      // can still show one when it does.
      appearance: "interaction-only",
      theme: "dark",
      // Tokens lapse after a few minutes and people linger on landing pages.
      "refresh-expired": "auto",
      callback: function(token){
        // A challenge the visitor solved after pressing the button: finish the
        // submission they already asked for.
        if (awaitingToken) {
          awaitingToken = false;
          send(token);
        }
      },
      "error-callback": function(){
        awaitingToken = false;
        button.disabled = false;
        setStatus("Couldn't run the human check — please reload and try again.", "err");
      }
    });
  };

  function send(token){
    button.disabled = true;
    setStatus("Submitting…");

    fetch(SIGNUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.value.trim(),
        turnstile_token: token,
        company: honeypot.value
      })
    }).then(function(res){
      button.disabled = false;
      // Tokens are single-use, so every attempt needs a fresh one.
      if (widgetId !== null) window.turnstile.reset(widgetId);

      if (res.status === 200) {
        // Covers "already on the list" too — the function answers both the same
        // way on purpose, so this form can't be used to test who has signed up.
        setStatus("You're on the list — we'll email you the link.", "ok");
        form.reset();
      } else if (res.status === 429) {
        setStatus("Too many attempts — please try again in a few minutes.", "err");
      } else if (res.status === 403) {
        setStatus("We couldn't verify you're human — please try again.", "err");
      } else if (res.status === 400) {
        setStatus("Please check that address and try again.", "err");
      } else {
        setStatus("Something went wrong — please try again.", "err");
      }
    }).catch(function(){
      button.disabled = false;
      if (widgetId !== null) window.turnstile.reset(widgetId);
      setStatus("Something went wrong — please try again.", "err");
    });
  }

  form.addEventListener("submit", function(e){
    e.preventDefault();

    if (honeypot.value) {
      setStatus("You're on the list — we'll email you the link.", "ok");
      form.reset();
      return;
    }

    if (!window.turnstile || widgetId === null) {
      setStatus("Still loading the human check — one moment, then try again.", "err");
      return;
    }

    var token = window.turnstile.getResponse(widgetId);
    if (token) {
      send(token);
      return;
    }

    // No token yet: either the check is still running, or Cloudflare wants an
    // interaction. Hand off to the callback above, which submits when it lands.
    awaitingToken = true;
    button.disabled = true;
    setStatus("Checking you're human…");
  });
})();
