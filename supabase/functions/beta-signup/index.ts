import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The only writer to public.beta_signups. PostgREST cannot check a CAPTCHA, so
// the anon key was revoked from the table: anything it would accept, a script
// would accept. This function redeems the Turnstile token first, then inserts
// under the service role.
//
// Rate limiting already lives in the database. public.begin_beta_signup(inet)
// reserves a slot against the *end user's* address under an advisory lock, and
// the BEFORE INSERT trigger on the table deliberately skips its own check when
// the caller is service_role — otherwise every visitor would share this
// runtime's egress address and jam the single bucket shut for everyone.

const SITE_ORIGINS = new Set([
  "https://claireworks.github.io",
  "https://rm8tes.com",
  "https://www.rm8tes.com",
]);

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Mirrors the beta_signups_email_shape check constraint, so a bad address comes
// back as a clean 400 instead of a constraint violation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":
      origin && SITE_ORIGINS.has(origin) ? origin : "https://rm8tes.com",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// The trigger reads cf-connecting-ip / sb-forwarded-for; we prefer the same
// header so both sides bucket on the identical address. x-forwarded-for is a
// client-supplied list, so only the first hop is worth anything here.
function clientIp(req: Request): string | null {
  const direct = req.headers.get("cf-connecting-ip") ??
    req.headers.get("sb-forwarded-for");
  if (direct) return direct.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return null;
}

async function tokenIsValid(
  secret: string,
  token: string,
  ip: string | null,
): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    body: form,
  });
  if (!res.ok) return false;

  const outcome = await res.json() as { success?: boolean };
  return outcome.success === true;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not set on this function");
    return json({ error: "misconfigured" }, 500, origin);
  }

  let payload: { email?: unknown; turnstile_token?: unknown; company?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400, origin);
  }

  // Honeypot. The browser form short-circuits this too, but a bot posting
  // straight at the endpoint never sees that code. Answer exactly as success
  // does, so filling it in tells the sender nothing.
  if (typeof payload.company === "string" && payload.company.trim() !== "") {
    return json({ ok: true }, 200, origin);
  }

  const email = typeof payload.email === "string"
    ? payload.email.trim().toLowerCase()
    : "";
  if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: "invalid_email" }, 400, origin);
  }

  const token = typeof payload.turnstile_token === "string"
    ? payload.turnstile_token
    : "";
  if (!token) {
    return json({ error: "human_check_failed" }, 403, origin);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = clientIp(req);

  // Reserve before verifying, not after: a caller hammering this with junk
  // tokens should burn through the budget, otherwise failed attempts are free.
  // begin_beta_signup fails closed when it cannot see an address.
  const { data: slot, error: slotError } = await supabase
    .rpc("begin_beta_signup", { p_ip: ip });

  if (slotError) {
    console.error("begin_beta_signup failed", slotError);
    return json({ error: "server_error" }, 500, origin);
  }
  if (slot !== true) {
    return json({ error: "rate_limited" }, 429, origin);
  }

  if (!await tokenIsValid(secret, token, ip)) {
    return json({ error: "human_check_failed" }, 403, origin);
  }

  const { error: insertError } = await supabase
    .from("beta_signups")
    .insert({ email });

  if (insertError) {
    // 23505: already on the list. Answered exactly like a fresh signup on
    // purpose — otherwise this form becomes an oracle for who has signed up.
    if (insertError.code === "23505") {
      return json({ ok: true }, 200, origin);
    }
    if (insertError.code === "23514") {
      return json({ error: "invalid_email" }, 400, origin);
    }
    console.error("beta_signups insert failed", insertError);
    return json({ error: "server_error" }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
});
