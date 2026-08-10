// Checking an rm8tes evidence record against the Bitcoin blockchain.
//
// Everything here runs in the reader's own browser. rm8tes serves two static
// JSON documents and nothing else: it does not get told the answer, cannot
// influence it, and could be offline for the last two steps entirely. The
// block header that settles the question is fetched from two independent
// explorers, and if they disagree this file refuses to conclude anything.
//
// The chain, in the order verify() walks it:
//
//   record hash          printed in the evidence pack, scanned from its QR code
//     -> leaf            SHA-256(0x00 || record hash)          [RFC 6962]
//     -> Merkle root     fold the sibling path                 [RFC 6962]
//     -> file digest     SHA-256(root bytes)                   [.ots header]
//     -> commitment      apply the OpenTimestamps operations
//     == block Merkle root of the block the proof names
//
// The last equality is the whole thing: a Bitcoin block header cannot be
// altered without redoing every block after it, so if the header's Merkle root
// is what this proof commits to, the record existed before that block was
// mined. No part of that rests on rm8tes being truthful.
//
// No build step, no dependencies. Deno imports this module directly to test it
// against live anchors; the browser loads the same file.

/// Where the proof documents live. Public, immutable, CDN-cached.
export const STORAGE_BASE =
  'https://iqpmsuoxylfniayrntfm.supabase.co/storage/v1/object/public/anchors';

/// Two operators, asked independently. One would be a single point of both
/// failure and dishonesty.
export const EXPLORERS = [
  { name: 'blockstream.info', api: 'https://blockstream.info/api' },
  { name: 'mempool.space', api: 'https://mempool.space/api' },
];

// ---- bytes ---------------------------------------------------------------

export const isHash = (s) => /^[0-9a-f]{64}$/.test(s);

export function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error('odd-length hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/// A Bitcoin Merkle root is held in the header least-significant byte first and
/// printed the other way round. Every comparison here is done in the printed
/// order, so this is where the two conventions meet.
export const reversedHex = (bytes) => bytesToHex(new Uint8Array([...bytes].reverse()));

export async function sha256(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    buf.set(p, at);
    at += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

// ---- the Merkle tree (RFC 6962) -----------------------------------------
//
// Leaves and internal nodes are hashed under different prefixes so that no leaf
// can be passed off as a branch. Recomputing a root needs only your own record
// and its siblings — never anybody else's records.

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

export const leafHash = (recordHash) => sha256(LEAF_PREFIX, recordHash);
export const nodeHash = (l, r) => sha256(NODE_PREFIX, l, r);

/// Folds a leaf up to its root. `side` names the side the *sibling* sits on.
export async function foldPath(leaf, path) {
  let acc = leaf;
  for (const step of path) {
    const sibling = hexToBytes(step.h);
    acc = step.side === 'left'
      ? await nodeHash(sibling, acc)
      : await nodeHash(acc, sibling);
  }
  return acc;
}

// ---- the OpenTimestamps proof -------------------------------------------
//
// Just enough of the format to read a detached proof and walk it. The format is
// documented at opentimestamps.org; the shape is a tree of operations with
// attestations hanging off it, where every entry but the last in a node carries
// a 0xff prefix.

const HEADER_MAGIC =
  '004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294';
const OP_SHA256 = 0x08;
const OP_APPEND = 0xf0;
const OP_PREPEND = 0xf1;
const BITCOIN_TAG = '0588960d73d71901';
const PENDING_TAG = '83dfe30d2ef90c8e';

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  byte() {
    if (this.pos >= this.buf.length) throw new Error('unexpected end of proof');
    return this.buf[this.pos++];
  }
  bytes(n) {
    if (this.pos + n > this.buf.length) throw new Error('unexpected end of proof');
    return this.buf.slice(this.pos, (this.pos += n));
  }
  varuint() {
    let value = 0, shift = 0;
    for (;;) {
      const b = this.byte();
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return value;
      shift += 7;
      if (shift > 35) throw new Error('varuint too long');
    }
  }
  varbytes() {
    return this.bytes(this.varuint());
  }
}

function parseTimestamp(r, depth = 0) {
  if (depth > 256) throw new Error('proof nested too deeply');
  const stamp = { attestations: [], ops: [] };
  const entry = (tag) => {
    if (tag === 0x00) {
      stamp.attestations.push({
        tag: bytesToHex(r.bytes(8)),
        payload: r.varbytes(),
      });
    } else {
      const op = tag === OP_APPEND || tag === OP_PREPEND
        ? { tag, arg: r.varbytes() }
        : { tag };
      stamp.ops.push({ op, stamp: parseTimestamp(r, depth + 1) });
    }
  };
  let tag = r.byte();
  while (tag === 0xff) {
    entry(r.byte());
    tag = r.byte();
  }
  entry(tag);
  return stamp;
}

export function parseDetached(bytes) {
  const r = new Reader(bytes);
  if (bytesToHex(r.bytes(HEADER_MAGIC.length / 2)) !== HEADER_MAGIC) {
    throw new Error('not an OpenTimestamps proof');
  }
  const major = r.byte();
  if (major !== 1) throw new Error(`unsupported .ots version ${major}`);
  const hashOp = r.byte();
  if (hashOp !== OP_SHA256) {
    throw new Error(`unsupported file hash op 0x${hashOp.toString(16)}`);
  }
  return { fileDigest: r.bytes(32), stamp: parseTimestamp(r) };
}

async function applyOp(msg, op) {
  if (op.tag === OP_SHA256) return await sha256(msg);
  if (op.tag === OP_APPEND) {
    const out = new Uint8Array(msg.length + op.arg.length);
    out.set(msg, 0);
    out.set(op.arg, msg.length);
    return out;
  }
  if (op.tag === OP_PREPEND) {
    const out = new Uint8Array(op.arg.length + msg.length);
    out.set(op.arg, 0);
    out.set(msg, op.arg.length);
    return out;
  }
  // An operation this file cannot evaluate costs us that branch and no more.
  return null;
}

/// Every Bitcoin attestation, with the message the node holding it commits to.
///
/// Reaching that message means actually applying the operations on the way
/// down. Reading the height alone — which is all the tag carries — would be
/// taking the timestamp calendar's word for which block the proof landed in.
export async function bitcoinPoints(stamp, rootMsg) {
  const found = [];
  const walk = async (node, msg) => {
    for (const a of node.attestations) {
      if (a.tag === BITCOIN_TAG) {
        found.push({ height: new Reader(a.payload).varuint(), msg });
      }
    }
    for (const { op, stamp: sub } of node.ops) {
      const next = await applyOp(msg, op);
      if (next !== null) await walk(sub, next);
    }
  };
  await walk(stamp, rootMsg);
  return found.sort((a, b) => a.height - b.height);
}

/// True while the proof rests only on a calendar's promise to publish it.
export function isPendingOnly(stamp) {
  let pending = false, bitcoin = false;
  const walk = (n) => {
    for (const a of n.attestations) {
      if (a.tag === BITCOIN_TAG) bitcoin = true;
      if (a.tag === PENDING_TAG) pending = true;
    }
    for (const { stamp: s } of n.ops) walk(s);
  };
  walk(stamp);
  return !bitcoin && pending;
}

// ---- fetching ------------------------------------------------------------

/// Fetches a proof document, or null when there is none.
///
/// Storage answers a missing object with HTTP 400 and puts the real 404 in the
/// body, so the status line alone cannot tell "no such proof" from "something
/// went wrong". The difference matters: the first is a plain answer to show the
/// reader, the second must never be reported as one.
async function getJson(url) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (res.ok) return await res.json();
  if (res.status === 404) return null;
  if (res.status === 400) {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      if (parsed.error === 'not_found' || parsed.statusCode === '404') return null;
    } catch {
      // Not JSON, so not the shape storage uses to say "no such object".
    }
  }
  throw new Error(`${url} returned ${res.status}`);
}

export const fetchLeaf = (recordHash) =>
  getJson(`${STORAGE_BASE}/leaf/${recordHash}.json`);
export const fetchBatch = (merkleRoot) =>
  getJson(`${STORAGE_BASE}/${merkleRoot}.json`);

/// What one explorer says block `height` is. Never throws: an explorer being
/// down is a fact about the explorer, not about the proof.
async function askExplorer(explorer, height) {
  try {
    const hashRes = await fetch(`${explorer.api}/block-height/${height}`);
    if (hashRes.status === 404) {
      return { name: explorer.name, state: 'missing' };
    }
    if (!hashRes.ok) return { name: explorer.name, state: 'unreachable' };
    const id = (await hashRes.text()).trim();
    if (!isHash(id)) return { name: explorer.name, state: 'unreachable' };

    const blockRes = await fetch(`${explorer.api}/block/${id}`);
    if (!blockRes.ok) return { name: explorer.name, state: 'unreachable' };
    const block = await blockRes.json();
    if (!isHash(block.merkle_root ?? '')) {
      return { name: explorer.name, state: 'unreachable' };
    }
    return {
      name: explorer.name,
      state: 'found',
      id,
      merkleRoot: block.merkle_root,
      time: typeof block.timestamp === 'number'
        ? new Date(block.timestamp * 1000).toISOString()
        : null,
    };
  } catch {
    return { name: explorer.name, state: 'unreachable' };
  }
}

export const fetchBlock = (height) =>
  Promise.all(EXPLORERS.map((e) => askExplorer(e, height)));

// ---- the verification ----------------------------------------------------

const check = (id, label) => ({ id, label, ok: null, detail: '' });

/// Runs the whole chain for one record hash.
///
/// `onProgress` is called with the result object after every step, so a caller
/// can render the checks filling in rather than waiting for the end. The result
/// is returned as well.
///
/// Outcomes:
///   verified  every step passed; the record existed before its block
///   pending   real and anchored, but Bitcoin has not published it yet
///   unknown   we could not reach the explorers, so nothing is concluded
///   notfound  no proof document for this hash
///   failed    a step contradicted another — the interesting one
export async function verify(recordHash, onProgress = () => {}) {
  const result = {
    status: 'failed',
    recordHash,
    leaf: null,
    batch: null,
    block: null,
    sources: [],
    otsHex: null,
    checks: [
      check('found', 'Proof document located'),
      check('fold', 'Record folds to the batch root'),
      check('digest', 'Root matches the timestamp proof'),
      check('commit', 'Proof names a Bitcoin block'),
      check('block', 'Block header commits to that root'),
    ],
  };
  const at = (id) => result.checks.find((c) => c.id === id);
  const step = () => onProgress(result);
  const fail = (id, detail) => {
    at(id).ok = false;
    at(id).detail = detail;
    step();
    return result;
  };

  if (!isHash(recordHash)) {
    result.status = 'notfound';
    return fail('found', 'That is not a 64-character record hash.');
  }

  // 1. The two documents.
  let leaf, batch;
  try {
    leaf = await fetchLeaf(recordHash);
    if (leaf === null) {
      result.status = 'notfound';
      return fail(
        'found',
        'No proof is published for this hash. Either it was never anchored, ' +
          'or the record it covers has since been deleted.',
      );
    }
    batch = await fetchBatch(leaf.merkle_root);
    if (batch === null) {
      return fail('found', `No batch document for root ${leaf.merkle_root}.`);
    }
  } catch (e) {
    result.status = 'unknown';
    return fail('found', `Could not fetch the proof: ${e.message}`);
  }

  result.leaf = leaf;
  result.batch = batch;
  result.otsHex = batch.ots;
  at('found').ok = true;
  at('found').detail =
    `Batch of ${batch.leaf_count} record${batch.leaf_count === 1 ? '' : 's'}, ` +
    `anchored ${batch.anchored_at}. This record is leaf ${leaf.leaf_index}.`;
  step();

  // 2. Fold the record up to the root.
  const folded = bytesToHex(
    await foldPath(await leafHash(hexToBytes(recordHash)), leaf.merkle_path),
  );
  if (folded !== batch.merkle_root) {
    return fail(
      'fold',
      `The path folds to ${folded}, not to ${batch.merkle_root}.`,
    );
  }
  at('fold').ok = true;
  at('fold').detail = leaf.merkle_path.length === 0
    ? 'The batch held one record, so the record is the root.'
    : `${leaf.merkle_path.length} sibling` +
      `${leaf.merkle_path.length === 1 ? '' : 's'} folded to ${batch.merkle_root}.`;
  step();

  // 3. The proof has to be a proof about *this* root.
  let parsed;
  try {
    parsed = parseDetached(hexToBytes(batch.ots));
  } catch (e) {
    return fail('digest', `The timestamp proof will not parse: ${e.message}`);
  }
  const rootDigest = bytesToHex(await sha256(hexToBytes(batch.merkle_root)));
  const claimedDigest = bytesToHex(parsed.fileDigest);
  if (rootDigest !== claimedDigest) {
    return fail(
      'digest',
      `The proof timestamps ${claimedDigest}, but SHA-256 of this root is ` +
        `${rootDigest}.`,
    );
  }
  at('digest').ok = true;
  at('digest').detail =
    `The .ots proof timestamps SHA-256 of the root, ${rootDigest}.`;
  step();

  // 4. Walk the proof to whatever block it names.
  const points = await bitcoinPoints(parsed.stamp, parsed.fileDigest);
  if (points.length === 0) {
    result.status = isPendingOnly(parsed.stamp) ? 'pending' : 'failed';
    at('commit').ok = result.status === 'pending' ? null : false;
    at('commit').detail = result.status === 'pending'
      ? 'The timestamp calendars have accepted this root and it is waiting ' +
        'for a Bitcoin block — normally a matter of hours. Everything above ' +
        'is already checked; come back later for the rest.'
      : 'The proof names no Bitcoin block and carries no pending promise.';
    step();
    return result;
  }
  const point = points[0];
  const committed = reversedHex(point.msg);
  at('commit').ok = true;
  at('commit').detail =
    `Block ${point.height.toLocaleString('en-GB')}. Following the proof's ` +
    `operations from the root arrives at ${committed}, which has to be that ` +
    `block's own Merkle root.`;
  step();

  // 5. Ask the chain, through two people who are not us.
  const sources = await fetchBlock(point.height);
  result.sources = sources;
  const found = sources.filter((s) => s.state === 'found');
  const agreed = new Set(found.map((s) => s.merkleRoot));

  if (found.length === 0) {
    const denied = sources.some((s) => s.state === 'missing');
    result.status = denied ? 'failed' : 'unknown';
    at('block').ok = denied ? false : null;
    at('block').detail = denied
      ? `No block ${point.height} exists.`
      : 'Neither block explorer could be reached, so this last step is ' +
        'unproven either way. Nothing above depends on them.';
    step();
    return result;
  }
  if (agreed.size > 1) {
    result.status = 'unknown';
    at('block').ok = null;
    at('block').detail =
      'The two block explorers disagree about this block, which is not ' +
      'something this page will pick a winner from.';
    step();
    return result;
  }

  const blockRoot = [...agreed][0];
  if (blockRoot !== committed) {
    return fail(
      'block',
      `Block ${point.height} has Merkle root ${blockRoot}, but this proof ` +
        `commits to ${committed}. They do not match.`,
    );
  }

  result.block = {
    height: point.height,
    time: found.find((s) => s.time)?.time ?? null,
    id: found[0].id,
    merkleRoot: blockRoot,
  };
  result.status = 'verified';
  at('block').ok = true;
  at('block').detail =
    `${found.map((s) => s.name).join(' and ')} ` +
    `${found.length === 1 ? 'reports' : 'both report'} the same Merkle root ` +
    `for block ${point.height.toLocaleString('en-GB')}.`;
  step();
  return result;
}
