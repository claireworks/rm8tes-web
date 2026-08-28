// The verification page's own wiring: read a hash out of the address bar, run
// verify(), draw the result. All of the reasoning lives in verify.js.
//
// In a file rather than an inline <script type="module"> so this page can
// declare `script-src 'self'` with no 'unsafe-inline' escape hatch.

import { verify, hexToBytes, isHash, isHex, EXPLORERS } from './verify.js';

const form = document.getElementById('form');
const input = document.getElementById('hash');
const out = document.getElementById('out');
const banner = document.getElementById('banner');
const checksEl = document.getElementById('checks');
const factsEl = document.getElementById('facts');
const downloads = document.getElementById('downloads');
const dlHint = document.getElementById('dl-hint');
const dlOts = document.getElementById('dl-ots');
const dlRoot = document.getElementById('dl-root');

const BANNERS = {
  running:  ['Checking…', 'Reading the proof and asking the blockchain.'],
  verified: ['Verified', 'This record was already fixed when the block below was mined.'],
  pending:  ['Awaiting a block', 'Real and anchored, but Bitcoin has not published it yet.'],
  notfound: ['No proof found', 'Nothing is published for that hash.'],
  unknown:  ['Not concluded', 'The last step could not be completed. Nothing here says the record is wrong.'],
  failed:   ['Does not check out', 'A step contradicted another. The detail is below.'],
};

const MARKS = { true: '✓', false: '✗', wait: '○', idle: '·' };

function markOf(check, status) {
  if (check.ok === true) return 'true';
  if (check.ok === false) return 'false';
  // A check with a detail but no verdict is one we deliberately stopped at.
  if (check.detail) return 'wait';
  return status === 'running' ? 'idle' : 'idle';
}

function render(result) {
  out.hidden = false;
  const [title, sub] = BANNERS[result.status] ?? BANNERS.failed;
  banner.dataset.state = result.status;
  banner.innerHTML = '';
  banner.append(title, Object.assign(document.createElement('small'), { textContent: sub }));

  checksEl.replaceChildren(...result.checks.map((c) => {
    const li = document.createElement('li');
    li.dataset.ok = markOf(c, result.status);
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = MARKS[li.dataset.ok];
    const body = document.createElement('div');
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = c.label;
    body.append(label);
    if (c.detail) {
      const d = document.createElement('p');
      d.className = 'detail';
      d.textContent = c.detail;
      body.append(d);
    }
    li.append(mark, body);
    return li;
  }));

  // Whole seconds, plainly labelled UTC. Fractions are noise to a reader and
  // the source has them only sometimes, which would otherwise show through.
  //
  // The type check is not defensive habit: anchored_at arrives inside a JSON
  // document, so a number or a null there would throw on .replace and take the
  // whole render down mid-result -- losing the checks that had already passed.
  // An unreadable timestamp is worth saying so about, not dying over.
  const stamp = (iso) => typeof iso === 'string'
    ? iso.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC')
    : 'not stated';

  const rows = [];
  const add = (k, v) => rows.push([k, v]);
  add('Record', result.recordHash);
  if (result.batch) {
    add('Merkle root', result.batch.merkle_root);
    add('Anchored', stamp(result.batch.anchored_at));
  }
  if (result.block) {
    add('Block', result.block.height.toLocaleString('en-GB'));
    if (result.block.time) add('Mined', stamp(result.block.time));
  }

  factsEl.replaceChildren(...rows.map(([k, v]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    row.append(dt, dd);
    return row;
  }));

  // Links out to both explorers, so the reader can see the block for
  // themselves rather than taking this page's word for it either.
  if (result.block) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = 'See it at';
    const dd = document.createElement('dd');
    EXPLORERS.forEach((e, i) => {
      if (i) dd.append(' · ');
      const a = document.createElement('a');
      a.href = `https://${e.name}/block/${result.block.id}`;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      a.textContent = e.name;
      dd.append(a);
    });
    row.append(dt, dd);
    factsEl.append(row);
  }

  // verify() rejects a batch document whose root or proof is not hex before it
  // ever reaches here, so these two checks should always pass. They are cheap,
  // and the alternative if one day they do not is hexToBytes throwing inside
  // the renderer, which loses a result the reader had already been shown.
  const showDl = Boolean(
    result.batch && isHash(result.batch.merkle_root) && isHex(result.otsHex),
  );
  downloads.hidden = !showDl;
  dlHint.hidden = !showDl;
  if (showDl) {
    const stem = result.batch.merkle_root.slice(0, 16);
    dlOts.href = URL.createObjectURL(
      new Blob([hexToBytes(result.otsHex)], { type: 'application/octet-stream' }),
    );
    dlOts.download = `${stem}.bin.ots`;
    dlRoot.href = URL.createObjectURL(
      new Blob([hexToBytes(result.batch.merkle_root)], { type: 'application/octet-stream' }),
    );
    dlRoot.download = `${stem}.bin`;
  }
}

let running = false;
async function run(hash) {
  if (running) return;
  running = true;
  input.value = hash;
  out.hidden = false;
  banner.dataset.state = 'running';
  banner.textContent = BANNERS.running[0];
  try {
    render(await verify(hash.trim().toLowerCase(), render));
  } catch (e) {
    // verify() reports every outcome it anticipates in the result object, so
    // reaching here means a bug rather than a bad proof. Say that, instead of
    // leaving "Checking…" on screen for ever.
    banner.dataset.state = 'unknown';
    banner.innerHTML = '';
    banner.append(
      'Not concluded',
      Object.assign(document.createElement('small'), {
        textContent: `This page hit an error and stopped: ${e.message}. ` +
          'Nothing here says the record is wrong.',
      }),
    );
  } finally {
    running = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const hash = input.value.trim().toLowerCase();
  // Keeps the address bar shareable, and re-runs through the same path a
  // scanned QR code takes.
  if (location.hash.slice(1) === hash) run(hash);
  else location.hash = hash;
});

// The QR code printed in an evidence pack lands here. A fragment is used rather
// than a query string so the hash is never sent to a web server -- not ours,
// not GitHub's -- and stays out of every access log along the way.
function fromLocation() {
  const raw = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
  const hash = raw.startsWith('h=') ? raw.slice(2) : raw;
  if (isHash(hash)) run(hash);
}
addEventListener('hashchange', fromLocation);
fromLocation();
