// Home-page motion — the three things the stylesheet cannot do on its own.
//
// Everything here is an enhancement over a page that is already finished. Block
// this file and the hero still reads, the statusline still says what it says,
// and the cards still sit where they sit. That is not politeness: five of the
// seven pages on this site declare `script-src 'none'`, so the motion layer had
// to be written in CSS to begin with, and this is only the remainder — pointer
// tracking, typing, and a wandering GPS fix, none of which a stylesheet knows
// anything about.
//
// Loaded ahead of beta-signup.js purely so that file stays adjacent to the
// Turnstile tag it has to precede.
(function(){
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---- pointer tilt ------------------------------------------------------
     The two panels that are meant to read as objects on a desk rather than
     blocks in a column. Mouse only: a finger has no hover, so on a touch screen
     this would fire once on tap and then stick at whatever angle it caught.

     Writes `transform`, which is free because the card's entrance animation is
     written against `translate` — see the note at the top of style.css. */
  function tilt(el, deg){
    var frame = 0, rx = 0, ry = 0;

    function paint(){
      frame = 0;
      el.style.transform =
        "perspective(900px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg)";
    }

    el.addEventListener("pointermove", function(e){
      if (e.pointerType !== "mouse" || still.matches) return;
      var r = el.getBoundingClientRect();
      ry = ((e.clientX - r.left) / r.width  - .5) *  2 * deg;
      rx = ((e.clientY - r.top)  / r.height - .5) * -2 * deg;
      // No transition while the pointer is on it, or the card lags behind the
      // cursor by a visible beat.
      el.classList.remove("is-releasing");
      if (!frame) frame = requestAnimationFrame(paint);
    });

    el.addEventListener("pointerleave", function(){
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      // The return journey is handed back to CSS: arm the transition, then drop
      // the inline transform so it settles onto the base perspective.
      el.classList.add("is-releasing");
      el.style.transform = "";
    });

    el.addEventListener("transitionend", function(){
      el.classList.remove("is-releasing");
    });
  }

  /* ---- the statusline ----------------------------------------------------
     A terminal that is still connected to something. The lines come out of the
     markup rather than out of this file, so the one in the HTML is the one a
     visitor sees with JavaScript off, and it is a true sentence on its own. */
  function typewriter(el){
    var lines = (el.getAttribute("data-lines") || "").split("|")
      .map(function(s){ return s.trim(); })
      .filter(Boolean);
    if (lines.length < 2 || still.matches) return;

    var TYPE = 42, ERASE = 22, HOLD = 6200, PAUSE = 260;
    var i = 0;                     // which line
    var n = lines[0].length;       // how much of it is showing
    var erasing = true;            // the first line is already up, so it goes first

    function tick(){
      if (still.matches) { el.textContent = lines[i]; return; }

      var line = lines[i], wait;

      if (erasing) {
        n -= 1;
        el.textContent = line.slice(0, n);
        if (n <= 0) { erasing = false; i = (i + 1) % lines.length; wait = PAUSE; }
        else wait = ERASE;
      } else {
        n += 1;
        el.textContent = line.slice(0, n);
        if (n >= line.length) { erasing = true; wait = HOLD; }
        else wait = TYPE;
      }

      setTimeout(tick, wait);
    }

    setTimeout(tick, HOLD);
  }

  /* ---- the fix -----------------------------------------------------------
     A GPS lock is never quite still. The readout wanders in its last decimal
     place, which is roughly ten metres — enough to look live, and small enough
     that the digit count never changes, so nothing in the status bar moves. */
  function drift(el){
    var raw = el.getAttribute("data-base");
    var base = parseFloat(raw);
    var places = (raw.split(".")[1] || "").length;
    if (isNaN(base)) return;

    setInterval(function(){
      if (document.hidden || still.matches) return;
      el.textContent = (base + (Math.random() - .5) * 0.0006).toFixed(places);
    }, 2600);
  }

  var record = document.querySelector(".record");
  var flatmates = document.querySelector(".flatmates");
  if (record) tilt(record, 3.2);
  if (flatmates) tilt(flatmates, 2.6);

  var typed = document.querySelector(".statusline .typed");
  if (typed) typewriter(typed);

  Array.prototype.forEach.call(document.querySelectorAll(".readout .coord"), drift);
})();
