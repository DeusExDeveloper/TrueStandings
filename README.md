# WSS Standings

Shared standings tracker for an Assetto Corsa racing league (World Sim Series
format). **Public read-only** boards for everyone, **password-locked editing**
for the league admin. Deploys to Netlify; data persists in Netlify Blobs.

- **Frontend:** plain HTML/CSS/JS, no build step — [public/index.html](public/index.html)
- **Scoring:** pure, unit-tested functions — [public/scoring.js](public/scoring.js)
- **Backend:** Netlify Function + Blobs — [netlify/functions/standings.js](netlify/functions/standings.js)

## Deploy to Netlify

1. **Push this folder to a GitHub repo.**
2. On [Netlify](https://app.netlify.com): **Add new site → Import an existing
   project**, pick the repo. The build settings come from
   [netlify.toml](netlify.toml) (publish `public/`, functions in
   `netlify/functions/`) — no build command needed.
3. **Set the edit password.** Site configuration → **Environment variables** →
   add `EDIT_PASSWORD` = *your chosen password*.
4. **Trigger one redeploy** (Deploys → Trigger deploy → *Deploy site*) so the
   function picks up the new environment variable.

That's it. The public URL shows the standings to anyone. Click **Unlock
editing**, enter the password, and the Race Entry tab, penalty controls, stage
entry, and per-row lock toggles appear. Edits are held in memory until you press
**Save changes**, which writes to Netlify Blobs.

> **Opening `index.html` directly (off disk) won't load or save data** — the
> Netlify Function isn't running locally, so there's no backend to talk to. The
> page detects this and shows a clear notice, falling back to read-only
> placeholder data so you can still see the layout. To run the real thing
> locally, use the Netlify CLI: `npm install && npx netlify dev`.

## How access control works

- The password lives **only** in the `EDIT_PASSWORD` environment variable and is
  checked **only** server-side by the function. It never appears in the frontend
  code and is never written into saved data.
- **Unlock editing** sends the password to `GET ?check=1`; on success the
  password is kept in `sessionStorage` for that browser tab only (never
  `localStorage`). **Lock** clears it.
- Every **Save** re-sends the password as the `x-edit-password` header; the
  function re-verifies it before writing. A wrong/expired password is rejected
  (401) and the app drops back to read-only.
- The browser warns before closing the tab if there are unsaved edits.

## API (Netlify Function)

`GET /.netlify/functions/standings` (also `/api/standings`)

| Request | Auth | Behavior |
| --- | --- | --- |
| `GET` | none (public) | Returns `{ ok, league }`. Empty default league if nothing saved. |
| `GET ?check=1` | `x-edit-password` header | `200` if password matches, else `401`. Saves nothing. |
| `POST` | `x-edit-password` header | Validates password + body shape, saves the league. `{ ok: true }`, or `401` / `400`. |

The body may be the bare `league` object or `{ league }`. The function validates
that `teams`, `drivers`, `races`, `penalties` are arrays and `results` is an
object before saving (`stages` optional).

## Run / test locally

```bash
npm install
npm test            # scoring (13) + function integration (12) tests
npx netlify dev     # full local stack: static site + function + Blobs
```

## Scoring rules

Fixed points table (hardcoded, not editable). Sprints use the **same** table:

| Pos | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13+ |
| --- | -- | -- | -- | -- | -- | -- | - | - | - | -- | -- | -- | --- |
| Pts | 36 | 26 | 22 | 18 | 15 | 12 | 9 | 7 | 5 | 3 | 2 | 1 | 0 |

- **DNF / DSQ always score 0**, regardless of position.
- **Driver total** counts every race the driver scored in, ignoring the
  Team/Independent flag.
- **Team total** counts, per race, only the drivers flagged **Team** that race.
  The flag is a manual per-driver, per-race choice — never auto-picked. The same
  driver can be Team one race and Independent the next.
- **Validation, not auto-fix:** 3+ team-scoring drivers in one race (league max
  is 2) raises a visible ⚑ warning; scoring still saves exactly what was entered.

## Data model

Top level is `appData` — multiple self-contained seasons. Rosters are NOT
shared across seasons (a driver in two seasons is two records, matched by name
only for the All-Time view). The frontend keeps `league` pointing at the active
season, so all scoring/rendering operates on one season unchanged.

```js
appData = {
  activeSeasonId: string,         // which season is currently selected
  seasons: [ season, ... ],
}

season = {
  id, name,                                             // e.g. "Season 1"
  title: string,
  teams:   [{ id, name, color }],                       // color = hex row accent
  drivers: [{ id, name, teamId, number, locked }],      // locked = row frozen
  races:   [{ id, label, kind: "race" | "sprint", locked }],
  results: {                                            // keyed `${driverId}_${raceId}`
    "driverId_raceId": { position, status, teamRace, fastestLap }  // status: finished|dnf|dsq
  },
  penalties: [{ id, driverId, points, qualiBan, qualiBan2, raceBan, seasonBan, note }],
}
```

On load, a legacy flat `league` (no `seasons` array) is migrated automatically
into `{ activeSeasonId: "season-1", seasons: [{ id: "season-1", name: "Season 1", ...}] }`.

## Project structure

```
public/index.html      SPA shell — boards, entry grid, modal, save/lock controls
public/styles.css      Carbon / timing-screen theme
public/scoring.js      Pure scoring logic (browser global + CommonJS for tests)
public/data.js         Read-only fallback seed (used only when backend unreachable)
public/app.js          Rendering, editing, persistence + auth wiring
netlify/functions/standings.js   GET (public) + ?check=1 + POST (password-gated) → Blobs
netlify.toml           publish=public, functions dir, /api/standings redirect
package.json           @netlify/blobs dep, "type": module, test scripts
test/                  scoring + function integration tests
```
