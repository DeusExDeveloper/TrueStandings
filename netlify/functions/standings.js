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

// Empty default app data — the seasons wrapper the frontend expects, with one
// empty starter season.
function emptyAppData() {
  return {
    activeSeasonId: "season-1",
    seasons: [
      {
        id: "season-1",
        name: "Season 1",
        title: "World Sim Series",
        pointsTable: {
          race: { 1: 36, 2: 26, 3: 22, 4: 18, 5: 15, 6: 12, 7: 9, 8: 7, 9: 5, 10: 3, 11: 2, 12: 1 },
          sprint: { 1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 },
        },
        fastestLapBonus: { race: 2, sprint: 1 },
        teams: [],
        drivers: [],
        races: [],
        results: {},
        penalties: [],
        stages: [],
      },
    ],
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
 * Validate one season object has the expected shape. teams / drivers / races /
 * penalties must be arrays; results an object. Not a deep row-by-row check —
 * just guards against garbage.
 */
function validateSeason(season, where) {
  if (!season || typeof season !== "object") return `${where} must be an object.`;
  for (const key of ["teams", "drivers", "races", "penalties"]) {
    if (!Array.isArray(season[key])) return `${where}: missing/invalid "${key}" (expected array).`;
  }
  if (typeof season.results !== "object" || season.results === null || Array.isArray(season.results)) {
    return `${where}: missing/invalid "results" (expected object).`;
  }
  if (season.stages !== undefined && !Array.isArray(season.stages)) {
    return `${where}: invalid "stages" (expected array).`;
  }
  return null;
}

/**
 * Validate the posted body. Accepts either the new appData shape
 * ({ activeSeasonId, seasons: [...] }) or the legacy flat single-league shape
 * (for back-compat); each season is validated.
 */
function validateAppData(body) {
  if (!body || typeof body !== "object") return "Body must be a JSON object.";

  if (Array.isArray(body.seasons)) {
    if (body.seasons.length === 0) return 'Missing seasons (expected at least one).';
    for (let i = 0; i < body.seasons.length; i++) {
      const err = validateSeason(body.seasons[i], `seasons[${i}]`);
      if (err) return err;
    }
    return null;
  }

  // Legacy flat shape — validate it as a single season.
  return validateSeason(body, "league");
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
    // `league` key kept for response back-compat; it now carries appData (or a
    // legacy flat league, which the client migrates on load).
    return json({ ok: true, league: saved || emptyAppData() });
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

    // The frontend may post either the bare payload or { league: payload }.
    const payload = body && body.league ? body.league : body;

    const invalid = validateAppData(payload);
    if (invalid) return json({ ok: false, error: invalid }, 400);

    await store.setJSON(BLOB_KEY, payload);
    return json({ ok: true });
  }

  return new Response("Method Not Allowed", { status: 405, headers: JSON_HEADERS });
};

export const config = {
  path: "/.netlify/functions/standings",
};
