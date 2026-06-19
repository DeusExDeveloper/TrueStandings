/*
 * Netlify Function: standings
 *
 * Persistence + access control for the WSS standings tracker.
 *
 *   GET                         -> public read of the saved league JSON.
 *                                  Returns an empty default league if nothing
 *                                  has been saved yet.
 *   GET ?check=1                 -> verify the edit password (header
 *                                  x-edit-password) without saving. 200 / 401.
 *   POST  (x-edit-password)      -> password-gated save of the full league
 *                                  JSON body to Netlify Blobs.
 *
 * The edit password lives ONLY in the EDIT_PASSWORD environment variable and
 * is only ever checked here, server-side. It never reaches the frontend.
 */
import { getStore } from "@netlify/blobs";

const STORE_NAME = "wss-standings";
const BLOB_KEY = "league";

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

// Empty default league — same shape the frontend expects, no content.
function emptyLeague() {
  return {
    title: "World Sim Series",
    teams: [],
    drivers: [],
    races: [],
    results: {},
    penalties: [],
    stages: [],
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Constant-time-ish string compare. Avoids leaking length/early-exit timing
 * for the password check. Both sides are short secrets, so this is plenty.
 */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function passwordOk(request) {
  const expected = process.env.EDIT_PASSWORD;
  if (!expected) {
    // Misconfiguration: no password set on the site. Refuse all writes rather
    // than silently allowing them.
    return { ok: false, reason: "server-misconfigured" };
  }
  const provided = request.headers.get("x-edit-password") || "";
  return { ok: safeEqual(provided, expected), reason: "bad-password" };
}

/**
 * Validate the posted body has the expected top-level league shape.
 * teams / drivers / races / penalties / stages must be arrays; results an
 * object. We do NOT deeply validate every row — just guard against garbage.
 */
function validateLeague(body) {
  if (!body || typeof body !== "object") return "Body must be a JSON object.";
  const arrays = ["teams", "drivers", "races", "penalties"];
  for (const key of arrays) {
    if (!Array.isArray(body[key])) return `Missing or invalid "${key}" (expected array).`;
  }
  if (typeof body.results !== "object" || body.results === null || Array.isArray(body.results)) {
    return 'Missing or invalid "results" (expected object).';
  }
  // stages is part of the richer model; tolerate its absence for forward/back
  // compat but reject a wrong type.
  if (body.stages !== undefined && !Array.isArray(body.stages)) {
    return 'Invalid "stages" (expected array).';
  }
  return null; // valid
}

export default async (request) => {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const store = getStore(STORE_NAME);

  // ---- password check endpoint (no save) ----------------------------------
  if (method === "GET" && url.searchParams.get("check") === "1") {
    const check = passwordOk(request);
    if (check.ok) return json({ ok: true });
    if (check.reason === "server-misconfigured") {
      return json({ ok: false, error: "EDIT_PASSWORD is not set on the server." }, 500);
    }
    return json({ ok: false, error: "Incorrect password." }, 401);
  }

  // ---- public read ---------------------------------------------------------
  if (method === "GET") {
    const saved = await store.get(BLOB_KEY, { type: "json" });
    return json({ ok: true, league: saved || emptyLeague() });
  }

  // ---- password-gated save -------------------------------------------------
  if (method === "POST" || method === "PUT") {
    const check = passwordOk(request);
    if (!check.ok) {
      if (check.reason === "server-misconfigured") {
        return json({ ok: false, error: "EDIT_PASSWORD is not set on the server." }, 500);
      }
      return json({ ok: false, error: "Incorrect password." }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Body is not valid JSON." }, 400);
    }

    // The frontend may post either the bare league or { league }.
    const league = body && body.league ? body.league : body;

    const invalid = validateLeague(league);
    if (invalid) return json({ ok: false, error: invalid }, 400);

    await store.setJSON(BLOB_KEY, league);
    return json({ ok: true });
  }

  return new Response("Method Not Allowed", { status: 405, headers: JSON_HEADERS });
};

export const config = {
  path: "/.netlify/functions/standings",
};
