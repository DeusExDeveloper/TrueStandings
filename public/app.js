/*
 * WSS Standings — app shell.
 *
 * State is `appData` = { activeSeasonId, seasons: [...] }. Each season is fully
 * self-contained (its own teams/drivers/races/results/penalties). `league` is a
 * live reference to the active season, so all rendering/scoring code operates on
 * it unchanged. The whole appData is saved/loaded via the Netlify Function
 * (Blobs-backed) with a password-gated POST. The edit password is NEVER stored
 * in this code or checked here — it is held only in sessionStorage for the
 * current tab while unlocked, sent as a header, and verified server-side.
 *
 * Depends on:
 *   - WSS                    (scoring.js) pure scoring functions
 *   - WSS_PLACEHOLDER_LEAGUE (data.js)    fallback seed (now an appData wrapper)
 */
(function () {
  "use strict";

  // --- backend / state -------------------------------------------------------

  const API = "/.netlify/functions/standings";
  const PW_KEY = "wss-edit-pw"; // sessionStorage key (this tab only)

  // Top-level state: multiple self-contained seasons + which one is active.
  let appData = emptyAppData();
  // `league` is a LIVE reference to the active season object inside appData.
  // All existing render/scoring code reads/writes it unchanged — it just points
  // at the active season's teams/drivers/races/results/penalties.
  let league = appData.seasons[0];
  // Deep clone of the whole appData last known to match the server (set on load
  // and after a successful save). Used to revert in-memory edits on "discard".
  let savedSnapshot = structuredClone(appData);
  let editMode = false;
  // View-only Race Grid row ordering (not persisted): "team" | "points" | "name".
  let gridSort = "team";
  let dirty = false; // unsaved in-memory edits since last load/save
  let backendOk = false; // did the initial fetch succeed?

  // Record the whole appData as the clean, server-matching baseline.
  function markSavedSnapshot() {
    savedSnapshot = structuredClone(appData);
    dirty = false;
    updateSaveButton();
  }

  // Revert all in-memory edits back to the last server-matching state.
  function revertToSnapshot() {
    appData = structuredClone(savedSnapshot);
    pointLeagueAtActiveSeason();
    dirty = false;
  }

  // Re-point `league` at the active season (call after any change that
  // replaces appData or switches the active season).
  function pointLeagueAtActiveSeason() {
    let season = appData.seasons.find((s) => s.id === appData.activeSeasonId);
    if (!season) {
      season = appData.seasons[0];
      if (season) appData.activeSeasonId = season.id;
    }
    if (!season) {
      // No seasons at all — create a default empty one.
      season = emptySeason("season-1", "Season 1");
      appData.seasons.push(season);
      appData.activeSeasonId = season.id;
    }
    league = season;
  }

  // A fresh, empty season (no teams/drivers/races/results/penalties).
  function emptySeason(id, name) {
    return {
      id,
      name,
      title: "World Sim Series",
      teams: [],
      drivers: [],
      races: [],
      results: {},
      penalties: [],
      stages: [],
    };
  }

  function emptyAppData() {
    const season = emptySeason("season-1", "Season 1");
    return { activeSeasonId: season.id, seasons: [season] };
  }

  // Password is kept only in sessionStorage (per-tab), never in localStorage,
  // never written into the saved league.
  function getPassword() {
    return sessionStorage.getItem(PW_KEY) || "";
  }
  function setPassword(pw) {
    sessionStorage.setItem(PW_KEY, pw);
  }
  function clearPassword() {
    sessionStorage.removeItem(PW_KEY);
  }

  // Mark the in-memory league as edited; refreshes the Save button state.
  function markDirty() {
    dirty = true;
    updateSaveButton();
  }

  // --- small helpers ---------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v != null) {
        node.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function resultKey(driverId, raceId) {
    return `${driverId}_${raceId}`;
  }

  function teamById(id) {
    return league.teams.find((t) => t.id === id);
  }

  // Parse a #rrggbb (or #rgb) hex to [r,g,b]; falls back to mid-grey.
  function parseHex(hex) {
    let h = (hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return [128, 128, 128];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  // Convert a hex color to an rgba() string at the given alpha. Used for the
  // non-sticky team-tinted race cells, which can be translucent because nothing
  // scrolls underneath them.
  function hexToRgba(hex, alpha) {
    const [r, g, b] = parseHex(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Composite `fg` over the opaque `bg` at `alpha`, returning a SOLID #rrggbb.
  // Used for sticky columns (Team/Driver/No.) where a translucent background
  // would let the horizontally-scrolled race columns bleed through.
  function blendHex(fg, bg, alpha) {
    const [fr, fg_, fb] = parseHex(fg);
    const [br, bg_, bb] = parseHex(bg);
    const mix = (f, b) => Math.round(f * alpha + b * (1 - alpha));
    const hx = (n) => n.toString(16).padStart(2, "0");
    return `#${hx(mix(fr, br))}${hx(mix(fg_, bg_))}${hx(mix(fb, bb))}`;
  }

  // Opaque base background for each team block (must match the CSS block rules).
  const BLOCK_BG = {
    "block-even": "#121419", // var(--bg-raised)
    "block-odd": "#0e1014",
    "block-orphan": "#140e0e",
  };

  function posTagText(result) {
    if (!result) return "—";
    if (result.status === "dnf") return "DNF";
    if (result.status === "dsq") return "DSQ";
    if (result.position == null) return "—";
    return `P${result.position}`;
  }

  // --- rendering: master race grid -------------------------------------------
  // The single source-of-truth table the whole app reads from. Every driver's
  // full season, race by race, grouped by team. It IS the race-entry screen:
  // in edit mode each race cell is click-to-edit (same inline editor); when
  // locked it's static. Totals reuse driverPoints() / teamPoints() — no
  // recomputation, no duplicate state.

  function renderGrid() {
    const wrap = $("#grid-view .grid-wrap");
    wrap.innerHTML = "";

    if (league.drivers.length === 0 || league.races.length === 0) {
      wrap.appendChild(
        el("div", {
          class: "empty-state",
          text: editMode
            ? "Add at least one team, driver, and race to start entering results."
            : "No race data yet.",
        })
      );
      renderWarnings();
      return;
    }

    const table = el("table", { class: "master-grid" });

    // ---- header: LOCKED · Team · Driver · # · races… · TOTAL ----
    const thead = el("thead");
    const headRow = el("tr");
    headRow.appendChild(el("th", { class: "mg-lock sticky-l", text: "" }));
    headRow.appendChild(el("th", { class: "mg-team sticky-l", text: "Team" }));
    headRow.appendChild(el("th", { class: "mg-driver sticky-l", text: "Driver" }));
    headRow.appendChild(el("th", { class: "mg-num sticky-l", text: "No." }));

    for (const race of league.races) {
      headRow.appendChild(renderRaceHeader(race));
    }
    headRow.appendChild(el("th", { class: "mg-total sticky-r", text: "TOTAL" }));
    thead.appendChild(headRow);
    table.appendChild(thead);

    // ---- body: ordering depends on the view-only sort mode ----
    const tbody = el("tbody");
    const orphanTeam = { id: null, color: "#666", name: "—" };
    const teamFor = (driver) => teamById(driver.teamId) || orphanTeam;

    if (gridSort === "team") {
      // Grouped by team block, teams by teamPoints() desc, drivers within by
      // driverPoints() desc. Alternating block shading + accent bar.
      const orderedTeams = WSS.teamStandings(
        league.teams,
        league.results,
        league.drivers,
        league.races
      ).map((s) => s.team);

      let blockIndex = 0;
      for (const team of orderedTeams) {
        const teamDrivers = league.drivers
          .filter((d) => d.teamId === team.id)
          .sort(
            (a, b) =>
              WSS.driverPoints(b.id, league.results, league.races) -
              WSS.driverPoints(a.id, league.results, league.races)
          );
        if (teamDrivers.length === 0) continue;

        const blockClass = blockIndex % 2 === 0 ? "block-even" : "block-odd";
        blockIndex += 1;
        for (const driver of teamDrivers) {
          tbody.appendChild(renderMasterRow(driver, team, blockClass));
        }
      }

      // Orphaned drivers (no/unknown team) — keep them visible rather than lost.
      for (const driver of league.drivers.filter((d) => !teamById(d.teamId))) {
        tbody.appendChild(renderMasterRow(driver, orphanTeam, "block-orphan"));
      }
    } else {
      // Flat list — no team grouping. Each row still shows its team name +
      // accent color. A single block class keeps backgrounds uniform.
      const flat = league.drivers.slice();
      if (gridSort === "points") {
        flat.sort(
          (a, b) =>
            WSS.driverPoints(b.id, league.results, league.races) -
              WSS.driverPoints(a.id, league.results, league.races) ||
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      } else {
        // "name" — alphabetical A→Z
        flat.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      }
      for (const driver of flat) {
        tbody.appendChild(renderMasterRow(driver, teamFor(driver), "block-even"));
      }
    }

    table.appendChild(tbody);
    wrap.appendChild(table);

    renderWarnings();
  }

  // One race column header. In edit mode the label is click-to-rename and the
  // RACE/SPR badge toggles the race kind; the per-race lock toggle is kept.
  // Read-only viewers see static label + badge (+ lock indicator if locked).
  function renderRaceHeader(race) {
    const th = el("th", { class: `mg-race ${race.locked ? "race-locked" : ""}` });

    // --- label (rename) ---
    if (editMode) {
      const labelInput = el("input", {
        type: "text",
        class: "race-label-input",
        value: race.label,
        title: "Rename race",
        onclick: (e) => e.stopPropagation(),
        onkeydown: (e) => {
          if (e.key === "Enter") e.target.blur();
        },
        onchange: (e) => {
          const v = e.target.value.trim();
          if (v) {
            race.label = v;
            markDirty();
            renderGrid(); // refresh titles/tooltips that embed the label
          } else {
            e.target.value = race.label; // reject empty
          }
        },
      });
      th.appendChild(labelInput);
    } else {
      th.appendChild(el("span", { class: "race-label", text: race.label }));
    }

    // --- kind badge (RACE / SPR) ---
    const isSprint = race.kind === "sprint";
    const badge = el("span", {
      class: `kind ${isSprint ? "sprint" : "race"} ${editMode ? "editable-badge" : ""}`,
      text: isSprint ? "SPR" : "RACE",
      title: editMode ? "Click to toggle Race / Sprint" : "",
    });
    if (editMode) {
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleRaceKind(race.id);
      });
    }
    th.appendChild(badge);

    // --- per-race lock (unchanged from before) ---
    if (editMode) {
      th.appendChild(
        el("button", {
          class: `race-lock-toggle ${race.locked ? "on" : ""}`,
          text: race.locked ? "🔒" : "🔓",
          title: race.locked
            ? `${race.label} is locked — click to unlock`
            : `Lock ${race.label}`,
          onclick: (e) => {
            e.stopPropagation();
            toggleRaceLock(race.id);
          },
        })
      );
    } else if (race.locked) {
      th.appendChild(el("span", { class: "race-lock-indicator", text: "🔒", title: "Locked" }));
    }

    return th;
  }

  // One driver row across the whole season. The team name is repeated on every
  // row (no merged/rowspan cell); the per-row left-accent shadow stacks into a
  // continuous bar per team block.
  function renderMasterRow(driver, team, blockClass) {
    const tr = el("tr", {
      class: `mg-row ${blockClass} ${driver.locked ? "locked" : ""}`,
    });

    // Opaque base bg for this block + a SOLID team tint blended over it. Sticky
    // columns must be fully opaque or the horizontally-scrolled race cells bleed
    // through them.
    const baseBg = BLOCK_BG[blockClass] || "#121419";
    const teamTintSolid = blendHex(team.color, baseBg, 0.22);

    // LOCKED cell (sticky) — display only. The lock is toggled on the Drivers
    // tab (this tab is for entering results, not managing the roster).
    const lockCell = el("td", { class: "mg-lock sticky-l", style: `background:${baseBg}` });
    if (driver.locked) {
      lockCell.appendChild(
        el("span", { class: "lock-icon", text: "🔒", title: "Row locked (manage on Drivers tab)" })
      );
    }
    tr.appendChild(lockCell);

    // TEAM cell (sticky), tinted with the team color. Rendered on EVERY row so
    // each driver's team is independently labeled — no merged/rowspan cell. The
    // per-row inset shadow stacks into a continuous left-accent bar per block.
    const teamCell = el("td", {
      class: "mg-team sticky-l",
      title: team.name,
      style: `background:${teamTintSolid};box-shadow:inset 4px 0 0 ${team.color}`,
    });
    teamCell.appendChild(el("span", { class: "mg-team-name", text: team.name }));
    tr.appendChild(teamCell);

    // DRIVER cell (sticky) — display only; managed on the Drivers tab.
    const driverCell = el("td", {
      class: "mg-driver sticky-l",
      title: driver.name,
      style: `background:${baseBg}`,
    });
    driverCell.appendChild(el("span", { class: "dname", text: driver.name }));
    tr.appendChild(driverCell);

    // NUMBER cell (sticky)
    tr.appendChild(
      el("td", {
        class: "mg-num sticky-l num",
        text: `#${driver.number}`,
        style: `background:${baseBg}`,
      })
    );

    // RACE cells
    for (const race of league.races) {
      tr.appendChild(renderResultCell(driver, race, team));
    }

    // TOTAL cell (sticky right) — reuses driverPoints(), the same function the
    // Driver Standings board uses. Opaque bg so race cells don't bleed through.
    const total = WSS.driverPoints(driver.id, league.results, league.races);
    tr.appendChild(
      el("td", {
        class: "mg-total sticky-r num",
        text: String(total),
        style: `background:${baseBg}`,
      })
    );

    return tr;
  }

  function renderResultCell(driver, race, team) {
    const result = WSS.getResult(league.results, driver.id, race.id);
    const readonly = driver.locked || !editMode;
    const isTeamScored = !!(result && result.teamRace === true && result.position != null);
    const overLimit =
      isTeamScored &&
      team.id &&
      WSS.isTeamRaceOverLimit(driver.teamId, race.id, league.results, league.drivers);

    const hasFastestLap = !!(result && result.fastestLap && result.position != null);
    const raceLocked = !!race.locked;

    // Background layering: a locked column shows a persistent yellow status
    // tint (visible to everyone); otherwise the team-scored cells show the team
    // tint. Locked wins so the whole column reads as locked at a glance.
    let bg = null;
    if (raceLocked) bg = "rgba(234, 179, 8, 0.16)"; // soft yellow (#eab308)
    else if (isTeamScored) bg = hexToRgba(team.color, 0.18);

    const td = el("td", {
      class:
        "mg-cell result-cell" +
        (driver.locked ? " readonly" : "") +
        (isTeamScored ? " team-scored" : "") +
        (overLimit ? " over-limit" : "") +
        (hasFastestLap ? " fastest-lap" : "") +
        (raceLocked ? " race-locked-cell" : ""),
      style: bg ? `background:${bg}` : null,
      title: overLimit
        ? `Warning: ${team.name} has 3+ team-scoring drivers in ${race.label}`
        : raceLocked
        ? `${race.label} is locked`
        : hasFastestLap
        ? "Fastest lap"
        : "",
    });

    if (!result || result.position == null) {
      // No entry yet — plain dash.
      td.appendChild(el("span", { class: "pos-tag empty", text: "-" }));
    } else if (result.status === "dnf" || result.status === "dsq") {
      td.appendChild(
        el("span", { class: `pos-tag ${result.status}`, text: result.status.toUpperCase() })
      );
    } else {
      // Show just the position code (e.g. "P3"). Points still drive all totals
      // and standings — they're simply no longer printed inline in every cell.
      td.appendChild(
        el("span", { class: "pos-tag", text: `P${result.position}` })
      );
    }

    // Clickable only when editable (unlocked app + unlocked row).
    if (!readonly) {
      td.classList.add("editable");
      td.addEventListener("click", () => {
        if (race.locked) {
          // Locked column: confirm before opening the editor.
          confirmDialog(
            `${race.label} is locked. Edit this result anyway?`,
            () => openCellEditor(driver, race),
            { title: "Locked race", confirmLabel: "Edit anyway", cancelLabel: "Cancel" }
          );
        } else {
          openCellEditor(driver, race);
        }
      });
    }
    return td;
  }

  function renderWarnings() {
    const banner = $("#warn-banner");
    const warnings = WSS.overLimitTeamRaces(league.results, league.drivers, league.races);
    if (warnings.length === 0 || !editMode) {
      banner.classList.remove("show");
      banner.innerHTML = "";
      return;
    }
    const lines = warnings.map((w) => {
      const t = teamById(w.teamId);
      const r = league.races.find((x) => x.id === w.raceId);
      return `${t ? t.name : w.teamId} — ${r ? r.label : w.raceId}: ${w.count} team-scoring drivers`;
    });
    banner.innerHTML =
      `<span class="icon">⚑</span><strong>Team limit exceeded</strong> ` +
      `(max ${WSS.MAX_TEAM_DRIVERS_PER_RACE} per race). Review the flagged cells — ` +
      `nothing was auto-changed:<br>` +
      lines.map((l) => `&nbsp;&nbsp;• ${l}`).join("<br>");
    banner.classList.add("show");
  }

  // --- cell editor modal -----------------------------------------------------

  function defaultTeamFlagFor(driver, race) {
    // Default the Team/Independent toggle to whatever this driver was set to
    // in their most recent prior race that has an entry.
    const idx = league.races.findIndex((r) => r.id === race.id);
    for (let i = idx - 1; i >= 0; i--) {
      const prev = WSS.getResult(league.results, driver.id, league.races[i].id);
      if (prev && typeof prev.teamRace === "boolean") return prev.teamRace;
    }
    return true; // sensible default: team
  }

  function openCellEditor(driver, race) {
    const existing = WSS.getResult(league.results, driver.id, race.id);
    const state = {
      // New/empty results default the position input to 0 (ready to type over);
      // an existing saved position opens with its real value, not reset to 0.
      position: existing && existing.position != null ? existing.position : 0,
      status: existing ? existing.status : "finished",
      teamRace: existing ? existing.teamRace : defaultTeamFlagFor(driver, race),
      fastestLap: existing ? !!existing.fastestLap : false,
    };

    const posInput = el("input", {
      type: "number",
      min: "1",
      placeholder: "—",
      value: state.position,
    });

    // status segmented control
    const statusSeg = el("div", { class: "seg status" });
    for (const [val, label] of [["finished", "Finished"], ["dnf", "DNF"], ["dsq", "DSQ"]]) {
      statusSeg.appendChild(
        el("button", {
          "data-val": val,
          class: state.status === val ? "active" : "",
          text: label,
          onclick: () => {
            state.status = val;
            $$("button", statusSeg).forEach((b) =>
              b.classList.toggle("active", b.getAttribute("data-val") === val)
            );
            updatePreview();
          },
        })
      );
    }

    // Team / Independent two-state switch — big and obvious.
    const teamSeg = el("div", { class: "seg" });
    function setTeamFlag(val) {
      state.teamRace = val;
      $$("button", teamSeg).forEach((b) =>
        b.classList.toggle("active", b.getAttribute("data-val") === (val ? "team" : "independent"))
      );
    }
    teamSeg.appendChild(
      el("button", {
        "data-val": "team",
        class: state.teamRace ? "active" : "",
        text: "Team",
        onclick: () => setTeamFlag(true),
      })
    );
    teamSeg.appendChild(
      el("button", {
        "data-val": "independent",
        class: !state.teamRace ? "active" : "",
        text: "Independent",
        onclick: () => setTeamFlag(false),
      })
    );

    const preview = el("div", { class: "seg-caption" });
    function updatePreview() {
      const posVal = posInput.value === "" ? null : parseInt(posInput.value, 10);
      const pts = WSS.pointsForResult(
        { position: posVal, status: state.status, fastestLap: state.fastestLap },
        race.kind
      );
      preview.textContent = `Scores: ${pts} pts`;
    }
    posInput.addEventListener("input", updatePreview);
    updatePreview();

    // Fastest Lap — simple on/off switch, off by default. Visual marker only;
    // it does not change points.
    const flSeg = el("div", { class: "seg fastlap" });
    function setFastestLap(val) {
      state.fastestLap = val;
      $$("button", flSeg).forEach((b) =>
        b.classList.toggle("active", b.getAttribute("data-val") === (val ? "on" : "off"))
      );
      updatePreview(); // bonus changes the scored total
    }
    flSeg.appendChild(
      el("button", {
        "data-val": "off",
        class: !state.fastestLap ? "active" : "",
        text: "Off",
        onclick: () => setFastestLap(false),
      })
    );
    flSeg.appendChild(
      el("button", {
        "data-val": "on",
        class: state.fastestLap ? "active" : "",
        text: "⏱ Fastest Lap",
        onclick: () => setFastestLap(true),
      })
    );

    const body = el("div", {}, [
      el("div", { class: "field" }, [
        el("label", { text: `${driver.name} — ${race.label}` }),
        posInput,
      ]),
      el("div", { class: "field" }, [
        el("label", { text: "Status" }),
        statusSeg,
      ]),
      el("div", { class: "field" }, [
        el("label", { text: "Scoring for this race" }),
        teamSeg,
        el("div", {
          class: "seg-caption",
          text: "Independent results don't add to the team total.",
        }),
        preview,
      ]),
      el("div", { class: "field" }, [
        el("label", { text: "Fastest lap" }),
        flSeg,
        el("div", { class: "seg-caption", text: "Marker only — does not change points." }),
      ]),
    ]);

    openModal(`Result · ${posTagText(existing)}`, body, () => {
      // Treat an empty box OR the placeholder 0 as "no position".
      const raw = posInput.value === "" ? null : parseInt(posInput.value, 10);
      const posVal = raw === 0 ? null : raw;
      const key = resultKey(driver.id, race.id);
      if (posVal == null && state.status === "finished") {
        // empty (or 0) finished entry = clear the result
        delete league.results[key];
      } else {
        league.results[key] = {
          position: posVal,
          status: state.status,
          teamRace: !!state.teamRace,
          fastestLap: !!state.fastestLap,
        };
      }
      markDirty();
      closeModal();
      renderAll();
    }, { extraButtons: existing ? [
      el("button", {
        class: "btn ghost",
        text: "Clear",
        onclick: () => {
          delete league.results[resultKey(driver.id, race.id)];
          markDirty();
          closeModal();
          renderAll();
        },
      }),
    ] : [] });
  }

  // --- add/remove teams, drivers, races --------------------------------------

  function openAddTeam() {
    const nameInput = el("input", { type: "text", placeholder: "Team name" });
    const colorInput = el("input", { type: "color", value: "#e10600" });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Team name" }), nameInput]),
      el("div", { class: "field" }, [
        el("label", { text: "Row accent color" }),
        colorInput,
      ]),
    ]);
    openModal("Add team", body, () => {
      const name = nameInput.value.trim();
      if (!name) return setModalError("Name is required.");
      league.teams.push({ id: uid("t"), name, color: colorInput.value });
      markDirty();
      closeModal();
      renderAll();
    });
  }

  function openAddDriver() {
    if (league.teams.length === 0) {
      return alert("Add a team first.");
    }
    const nameInput = el("input", { type: "text", placeholder: "Driver name" });
    const numInput = el("input", { type: "number", min: "0", placeholder: "Car #" });
    const teamSelect = el(
      "select",
      {},
      league.teams.map((t) => el("option", { value: t.id, text: t.name }))
    );
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Driver name" }), nameInput]),
      el("div", { class: "row" }, [
        el("div", { class: "field", style: "flex:1" }, [
          el("label", { text: "Team" }),
          teamSelect,
        ]),
        el("div", { class: "field", style: "width:90px" }, [
          el("label", { text: "Car #" }),
          numInput,
        ]),
      ]),
    ]);
    openModal("Add driver", body, () => {
      const name = nameInput.value.trim();
      if (!name) return setModalError("Name is required.");
      league.drivers.push({
        id: uid("d"),
        name,
        teamId: teamSelect.value,
        number: numInput.value === "" ? 0 : parseInt(numInput.value, 10),
        locked: false,
      });
      markDirty();
      closeModal();
      renderAll();
    });
  }

  function openAddRace() {
    const labelInput = el("input", { type: "text", placeholder: "e.g. R4 or R5 Sprint" });
    const kindSelect = el("select", {}, [
      el("option", { value: "race", text: "Race" }),
      el("option", { value: "sprint", text: "Sprint" }),
    ]);
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Label" }), labelInput]),
      el("div", { class: "field" }, [el("label", { text: "Kind" }), kindSelect]),
    ]);
    openModal("Add race", body, () => {
      const label = labelInput.value.trim();
      if (!label) return setModalError("Label is required.");
      league.races.push({ id: uid("r"), label, kind: kindSelect.value, locked: false });
      markDirty();
      closeModal();
      renderAll();
    });
  }

  // Toggle a race column's persisted lock (edit mode only). Stored as
  // race.locked, separate from the per-driver row lock.
  function toggleRaceLock(raceId) {
    const race = league.races.find((r) => r.id === raceId);
    if (!race) return;
    race.locked = !race.locked;
    markDirty();
    renderAll();
  }

  // Toggle a race between "race" and "sprint" (edit mode only). This changes
  // which points table applies to every result in that column, so re-render
  // everything (grid TOTALs + standings) to reflect updated point values.
  function toggleRaceKind(raceId) {
    const race = league.races.find((r) => r.id === raceId);
    if (!race) return;
    race.kind = race.kind === "sprint" ? "race" : "sprint";
    markDirty();
    renderAll();
  }

  // Race deletion is intentionally not surfaced in the grid header anymore
  // (too easy to misclick). Kept here for a future management surface.
  function removeRace(raceId) {
    const race = league.races.find((r) => r.id === raceId);
    confirmRemove(`Remove ${race ? race.label : "race"} and all its results?`, () => {
      league.races = league.races.filter((r) => r.id !== raceId);
      for (const key of Object.keys(league.results)) {
        if (key.endsWith(`_${raceId}`)) delete league.results[key];
      }
      markDirty();
      renderAll();
    });
  }
  void removeRace; // retained for future use; not wired to any control now

  function removeDriver(driverId) {
    const driver = league.drivers.find((d) => d.id === driverId);
    if (driver && driver.locked) {
      return alert("This driver's row is locked. Unlock it first to remove.");
    }
    confirmRemove(`Remove ${driver ? driver.name : "driver"} and all their results?`, () => {
      league.drivers = league.drivers.filter((d) => d.id !== driverId);
      for (const key of Object.keys(league.results)) {
        if (key.startsWith(`${driverId}_`)) delete league.results[key];
      }
      league.penalties = league.penalties.filter((p) => p.driverId !== driverId);
      markDirty();
      renderAll();
    });
  }

  function toggleLock(driverId) {
    const driver = league.drivers.find((d) => d.id === driverId);
    if (driver) driver.locked = !driver.locked;
    markDirty();
    renderAll();
  }

  function removeTeam(teamId) {
    const team = teamById(teamId);
    const teamDrivers = league.drivers.filter((d) => d.teamId === teamId);
    if (teamDrivers.length > 0) {
      return alert(
        `${team ? team.name : "This team"} still has ${teamDrivers.length} driver(s). ` +
          "Move or remove them (on the Drivers tab) before removing the team."
      );
    }
    confirmRemove(`Remove ${team ? team.name : "team"}?`, () => {
      league.teams = league.teams.filter((t) => t.id !== teamId);
      markDirty();
      renderAll();
    });
  }

  // --- shared helpers for boards ---------------------------------------------

  function teamChip(team) {
    return el("span", { class: "chip" }, [
      el("span", {
        class: "chip-dot",
        style: `background:${team ? team.color : "#666"}`,
      }),
      el("span", { class: "chip-label", text: team ? team.name : "—" }),
    ]);
  }

  function podiumClass(i) {
    return i < 3 ? "p" + (i + 1) : "";
  }

  // --- 1. Driver Standings board ---------------------------------------------

  function renderDriverBoard() {
    const tbody = $("#driver-board tbody");
    tbody.innerHTML = "";
    // Total columns: 4 read-only + 3 edit-only (No., Locked, actions).
    const cols = editMode ? 7 : 4;

    // Sort by points desc, ties broken alphabetically by name.
    const standings = WSS.driverStandings(league.drivers, league.results, league.races).sort(
      (a, b) =>
        b.points - a.points ||
        a.driver.name.localeCompare(b.driver.name, undefined, { sensitivity: "base" })
    );

    if (standings.length === 0) {
      tbody.appendChild(
        el("tr", {}, [el("td", { colspan: cols, class: "empty-cell", text: "No drivers yet." })])
      );
      return;
    }

    standings.forEach((entry, i) => {
      const driver = entry.driver;
      const team = teamById(driver.teamId);
      const tr = el("tr", { class: podiumClass(i) });

      tr.appendChild(el("td", { class: "col-pos num", text: String(i + 1) }));

      // Driver name: static in read-only, editable input in edit mode (rename).
      if (editMode) {
        const nameInput = el("input", {
          type: "text",
          class: "inline-text",
          value: driver.name,
          disabled: driver.locked ? "disabled" : null,
          onchange: (e) => {
            const v = e.target.value.trim();
            if (v) {
              driver.name = v;
              markDirty();
            } else {
              e.target.value = driver.name; // reject empty
            }
          },
        });
        tr.appendChild(el("td", { class: "name-cell" }, [nameInput]));
      } else {
        tr.appendChild(el("td", { class: "name-cell", text: driver.name }));
      }

      // Team cell: chip in read-only, dropdown in edit mode.
      if (editMode) {
        const teamSelect = el(
          "select",
          {
            class: "inline-select",
            disabled: driver.locked ? "disabled" : null,
            onchange: (e) => {
              driver.teamId = e.target.value;
              markDirty();
              renderAll();
            },
          },
          league.teams.map((t) =>
            el("option", { value: t.id, text: t.name, ...(t.id === driver.teamId ? { selected: "selected" } : {}) })
          )
        );
        tr.appendChild(el("td", {}, [teamSelect]));
      } else {
        tr.appendChild(el("td", {}, [teamChip(team)]));
      }

      tr.appendChild(el("td", { class: "col-pts num", text: String(entry.points) }));

      // Edit-only cells: No. / Locked / actions.
      if (editMode) {
        const numInput = el("input", {
          type: "number",
          class: "inline-num num",
          min: "0",
          value: String(driver.number),
          disabled: driver.locked ? "disabled" : null,
          onchange: (e) => {
            driver.number = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
            markDirty();
          },
        });
        tr.appendChild(el("td", { class: "col-num edit-only-cell" }, [numInput]));

        const lockCell = el("td", { class: "col-lock edit-only-cell" });
        lockCell.appendChild(
          el("button", {
            class: `btn small ${driver.locked ? "" : "ghost"}`,
            text: driver.locked ? "🔒 Locked" : "Unlocked",
            title: driver.locked ? "Click to unlock" : "Click to lock",
            onclick: () => toggleLock(driver.id),
          })
        );
        tr.appendChild(lockCell);

        const actCell = el("td", { class: "col-act edit-only-cell" });
        actCell.appendChild(
          el("button", {
            class: "btn small danger",
            text: "Remove",
            onclick: () => removeDriver(driver.id),
          })
        );
        tr.appendChild(actCell);
      }

      tbody.appendChild(tr);
    });
  }

  // --- 2. Team Standings board (expandable rows) -----------------------------

  // Tracks which team rows are expanded across re-renders.
  const expandedTeams = new Set();

  // Columns: 3 read-only (Pos, Team, Pts) + 2 edit-only (Color, actions).
  function teamBoardCols() {
    return editMode ? 5 : 3;
  }

  function renderTeamBoard() {
    const tbody = $("#team-board tbody");
    tbody.innerHTML = "";

    const standings = WSS.teamStandings(
      league.teams,
      league.results,
      league.drivers,
      league.races
    );

    if (standings.length === 0) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", { colspan: teamBoardCols(), class: "empty-cell", text: "No teams yet." }),
        ])
      );
      return;
    }

    standings.forEach((entry, i) => {
      const team = entry.team;
      const isOpen = expandedTeams.has(team.id);

      // Team name: static in read-only, editable input in edit mode (rename).
      let nameNode;
      if (editMode) {
        nameNode = el("input", {
          type: "text",
          class: "inline-text",
          value: team.name,
          onclick: (e) => e.stopPropagation(), // don't toggle expand
          onchange: (e) => {
            const v = e.target.value.trim();
            if (v) {
              team.name = v;
              markDirty();
              renderAll();
            } else {
              e.target.value = team.name;
            }
          },
        });
      } else {
        nameNode = el("span", { class: "name-cell", text: team.name });
      }

      const row = el("tr", { class: `team-standing ${podiumClass(i)} ${isOpen ? "open" : ""}` }, [
        el("td", { class: "col-pos num", text: String(i + 1) }),
        el("td", {}, [
          el("span", { class: "twisty", text: isOpen ? "▾" : "▸" }),
          el("span", { class: "chip-dot swatch", style: `background:${team.color}` }),
          nameNode,
        ]),
        el("td", { class: "col-pts num", text: String(entry.points) }),
      ]);

      if (editMode) {
        // Color picker
        const colorInput = el("input", {
          type: "color",
          class: "inline-color",
          value: team.color,
          onclick: (e) => e.stopPropagation(),
          onchange: (e) => {
            team.color = e.target.value;
            markDirty();
            renderAll();
          },
        });
        row.appendChild(el("td", { class: "col-color edit-only-cell" }, [colorInput]));
        // Remove
        const actCell = el("td", { class: "col-act edit-only-cell" });
        actCell.appendChild(
          el("button", {
            class: "btn small danger",
            text: "Remove",
            onclick: (e) => {
              e.stopPropagation();
              removeTeam(team.id);
            },
          })
        );
        row.appendChild(actCell);
      }

      row.addEventListener("click", () => {
        if (expandedTeams.has(team.id)) expandedTeams.delete(team.id);
        else expandedTeams.add(team.id);
        renderTeamBoard();
      });
      tbody.appendChild(row);

      if (isOpen) tbody.appendChild(renderTeamBreakdownRow(team));
    });
  }

  // Expanded detail: for each race, which drivers scored for the team
  // (teamRace:true) and how much.
  function renderTeamBreakdownRow(team) {
    const detail = el("td", { colspan: teamBoardCols(), class: "breakdown" });

    for (const race of league.races) {
      const scorers = league.drivers
        .filter((d) => d.teamId === team.id)
        .map((d) => ({ d, r: WSS.getResult(league.results, d.id, race.id) }))
        .filter((x) => x.r && x.r.teamRace === true)
        .map((x) => ({
          name: x.d.name,
          pts: WSS.pointsForResult(x.r, race.kind),
        }));

      const raceTotal = scorers.reduce((s, x) => s + x.pts, 0);
      const line = el("div", { class: "breakdown-line" });
      line.appendChild(el("span", { class: "bd-race", text: race.label }));
      if (scorers.length === 0) {
        line.appendChild(el("span", { class: "bd-empty", text: "— no team scorers" }));
      } else {
        const names = scorers
          .map((s) => `${s.name} (${s.pts})`)
          .join("  ·  ");
        line.appendChild(el("span", { class: "bd-drivers", text: names }));
        line.appendChild(el("span", { class: "bd-total num", text: `${raceTotal} pts` }));
      }
      detail.appendChild(line);
    }

    return el("tr", { class: "breakdown-row" }, [detail]);
  }

  // --- Stage Top 3 cards (auto-computed from race results) -------------------
  // Fully derived: the season's main races are split into 3 stages and each
  // sprint counts toward its neighboring stage (see WSS.stageStandings). No
  // manual entry.

  function renderStageCards() {
    const host = $("#stage-cards");
    host.innerHTML = "";

    const stages = WSS.stageStandings(league.races, league.drivers, league.results);

    // Fewer than 3 main races -> can't form 3 stages.
    if (!stages) {
      host.appendChild(el("div", { class: "stage-empty", text: "Not enough races yet" }));
      return;
    }

    for (const stage of stages) {
      const card = el("div", { class: "stage-card" });
      card.appendChild(el("div", { class: "stage-title", text: stage.label }));

      if (stage.standings.length === 0) {
        card.appendChild(el("div", { class: "stage-none", text: "No results yet" }));
      } else {
        stage.standings.forEach((entry, idx) => {
          const medalClass = idx < 3 ? "p" + (idx + 1) : "";
          const row = el("div", { class: `stage-row ${medalClass}` });
          row.appendChild(el("span", { class: "stage-rank num", text: String(idx + 1) }));
          row.appendChild(el("span", { class: "stage-name", text: entry.driver.name }));
          row.appendChild(el("span", { class: "stage-pts num", text: String(entry.points) }));
          card.appendChild(row);
        });
      }

      host.appendChild(card);
    }
  }

  // --- 3. Penalties board (manual entry) -------------------------------------

  const BAN_FIELDS = [
    ["qualiBan", "Quali Ban"],
    ["qualiBan2", "Quali Ban 2"],
    ["raceBan", "Race Ban"],
    ["seasonBan", "Season Ban"],
  ];

  function renderPenaltyBoard() {
    const tbody = $("#penalty-board tbody");
    tbody.innerHTML = "";

    const penalties = league.penalties || [];
    if (penalties.length === 0) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", {
            colspan: editMode ? 8 : 7,
            class: "empty-cell",
            text: "No penalties recorded.",
          }),
        ])
      );
      return;
    }

    for (const pen of penalties) {
      const driver = league.drivers.find((d) => d.id === pen.driverId);
      const tr = el("tr");

      // Driver
      tr.appendChild(el("td", { class: "name-cell", text: driver ? driver.name : "—" }));

      // Penalty points
      tr.appendChild(el("td", { class: "col-pts num", text: String(pen.points || 0) }));

      // Four ban toggle cells. The per-field class (ban-qualiBan etc.) lets the
      // stylesheet give each column its own filled severity color when active.
      for (const [field] of BAN_FIELDS) {
        const active = !!pen[field];
        const td = el("td", {
          class: `col-ban ban-cell ban-${field} ${active ? "on" : ""} ${editMode ? "clickable" : ""}`,
          text: active ? "✕" : "",
          title: editMode ? "Toggle" : "",
        });
        if (editMode) {
          td.addEventListener("click", () => {
            pen[field] = !pen[field];
            markDirty();
            renderPenaltyBoard();
          });
        }
        tr.appendChild(td);
      }

      // Note
      tr.appendChild(el("td", { class: "note-cell", text: pen.note || "" }));

      // Actions (edit mode)
      if (editMode) {
        const actCell = el("td", { class: "col-act" });
        actCell.appendChild(
          el("button", {
            class: "btn small",
            text: "Edit",
            onclick: () => openEditPenalty(pen),
          })
        );
        actCell.appendChild(
          el("button", {
            class: "btn small danger",
            text: "Remove",
            onclick: () => removePenalty(pen.id),
          })
        );
        tr.appendChild(actCell);
      }

      tbody.appendChild(tr);
    }
  }

  function openEditPenalty(existing) {
    const isNew = !existing;
    const pen = existing || {
      id: uid("p"),
      driverId: league.drivers[0] ? league.drivers[0].id : "",
      points: 0,
      qualiBan: false,
      qualiBan2: false,
      raceBan: false,
      seasonBan: false,
      note: "",
    };

    if (league.drivers.length === 0) {
      return alert("Add a driver first.");
    }

    const driverSelect = el(
      "select",
      {},
      league.drivers.map((d) =>
        el("option", {
          value: d.id,
          text: d.name,
          ...(d.id === pen.driverId ? { selected: "selected" } : {}),
        })
      )
    );
    const ptsInput = el("input", { type: "number", value: String(pen.points || 0) });
    const noteInput = el("input", { type: "text", value: pen.note || "", placeholder: "Context" });

    // Ban toggles as checkboxes in the form
    const banWrap = el("div", { class: "ban-toggle-wrap" });
    const banInputs = {};
    for (const [field, label] of BAN_FIELDS) {
      const cb = el("input", { type: "checkbox", ...(pen[field] ? { checked: "checked" } : {}) });
      banInputs[field] = cb;
      banWrap.appendChild(el("label", { class: "ban-toggle" }, [cb, document.createTextNode(" " + label)]));
    }

    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Driver" }), driverSelect]),
      el("div", { class: "field" }, [el("label", { text: "Penalty points" }), ptsInput]),
      el("div", { class: "field" }, [el("label", { text: "Bans" }), banWrap]),
      el("div", { class: "field" }, [el("label", { text: "Note" }), noteInput]),
    ]);

    openModal(isNew ? "Add penalty entry" : "Edit penalty", body, () => {
      pen.driverId = driverSelect.value;
      pen.points = ptsInput.value === "" ? 0 : parseInt(ptsInput.value, 10);
      pen.note = noteInput.value;
      for (const [field] of BAN_FIELDS) pen[field] = banInputs[field].checked;
      if (isNew) league.penalties.push(pen);
      markDirty();
      closeModal();
      renderAll();
    });
  }

  function removePenalty(penId) {
    confirmRemove("Remove this penalty entry?", () => {
      league.penalties = league.penalties.filter((p) => p.id !== penId);
      markDirty();
      renderAll();
    });
  }

  // --- modal plumbing --------------------------------------------------------

  let onConfirm = null;

  function openModal(title, bodyNode, confirmFn, opts = {}) {
    $("#modal-title").textContent = title;
    const body = $("#modal-body");
    body.innerHTML = "";
    body.appendChild(bodyNode);
    setModalError("");
    onConfirm = confirmFn;

    const actions = $("#modal-actions");
    actions.innerHTML = "";
    (opts.extraButtons || []).forEach((b) => actions.appendChild(b));
    actions.appendChild(
      el("button", { class: "btn ghost", text: opts.cancelLabel || "Cancel", onclick: closeModal })
    );
    actions.appendChild(
      el("button", {
        class: `btn ${opts.confirmClass || "primary"}`,
        text: opts.confirmLabel || "Save",
        onclick: () => onConfirm && onConfirm(),
      })
    );

    $("#modal-backdrop").classList.add("show");
  }

  // Generic confirmation modal styled like the rest of the app (replaces
  // native confirm()). `onYes` runs only when the confirm button is clicked;
  // Cancel / backdrop / Escape close it with no action.
  function confirmDialog(message, onYes, opts = {}) {
    const body = el("div", {}, [el("p", { class: "confirm-text", text: message })]);
    openModal(opts.title || "Confirm", body, () => {
      closeModal();
      onYes();
    }, {
      confirmLabel: opts.confirmLabel || "Yes",
      cancelLabel: opts.cancelLabel || "No",
      confirmClass: opts.confirmClass || "primary",
    });
  }

  // Destructive confirmation (red button, "Remove" / "Cancel"). Used by the
  // removal actions.
  function confirmRemove(message, onYes, opts = {}) {
    confirmDialog(message, onYes, {
      title: opts.title || "Confirm removal",
      confirmLabel: opts.confirmLabel || "Remove",
      cancelLabel: opts.cancelLabel || "Cancel",
      confirmClass: "danger-solid",
    });
  }

  function closeModal() {
    $("#modal-backdrop").classList.remove("show");
    onConfirm = null;
  }

  function setModalError(msg) {
    $("#modal-err").textContent = msg || "";
  }

  // --- backend: load + save --------------------------------------------------

  async function loadLeague() {
    try {
      const res = await fetch(API, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      appData = normalizeAppData(data.league);
      pointLeagueAtActiveSeason();
      backendOk = true;
      markSavedSnapshot(); // this is the clean server-matching baseline
      hideBanner();
    } catch (err) {
      // Almost always: opened as a local file, or the function isn't deployed.
      backendOk = false;
      appData = normalizeAppData(window.WSS_PLACEHOLDER_LEAGUE);
      pointLeagueAtActiveSeason();
      markSavedSnapshot(); // baseline = placeholder (can't save offline anyway)
      showOfflineBanner();
    }
    renderAll();
    updateSaveButton();
  }

  // Normalize one season object, filling in any missing fields.
  function normalizeSeason(raw, fallbackId, fallbackName) {
    const base = emptySeason(fallbackId, fallbackName);
    if (!raw || typeof raw !== "object") return base;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : fallbackId,
      name: typeof raw.name === "string" && raw.name ? raw.name : fallbackName,
      title: typeof raw.title === "string" ? raw.title : base.title,
      bestOf: raw.bestOf, // preserved if present, else undefined
      teams: Array.isArray(raw.teams) ? raw.teams : [],
      drivers: Array.isArray(raw.drivers) ? raw.drivers : [],
      races: Array.isArray(raw.races) ? raw.races : [],
      results: raw.results && typeof raw.results === "object" ? raw.results : {},
      penalties: Array.isArray(raw.penalties) ? raw.penalties : [],
      stages: Array.isArray(raw.stages) ? raw.stages : [],
    };
  }

  // Normalize the top-level appData. Handles three cases:
  //  - already the new shape ({ seasons: [...] })  -> normalize each season
  //  - the OLD flat shape ({ teams, drivers, ... }) -> migrate into one season
  //  - null/garbage                                 -> a fresh empty appData
  function normalizeAppData(raw) {
    if (raw && typeof raw === "object" && Array.isArray(raw.seasons)) {
      const seasons = raw.seasons.map((s, i) =>
        normalizeSeason(s, `season-${i + 1}`, `Season ${i + 1}`)
      );
      if (seasons.length === 0) return emptyAppData();
      const activeSeasonId =
        seasons.find((s) => s.id === raw.activeSeasonId) ? raw.activeSeasonId : seasons[0].id;
      return { activeSeasonId, seasons };
    }
    // One-time migration of the old flat single-league shape.
    if (raw && typeof raw === "object" && (raw.teams || raw.drivers || raw.races)) {
      const season = normalizeSeason(raw, "season-1", "Season 1");
      season.id = "season-1";
      season.name = raw.name || "Season 1";
      return { activeSeasonId: "season-1", seasons: [season] };
    }
    return emptyAppData();
  }

  let saving = false;

  // Save button handler: confirm first, then POST. This is the ONLY code path
  // that writes to the server.
  function saveChanges() {
    if (!editMode || saving || !dirty) return;
    confirmDialog(
      "Save these changes? This updates the standings everyone sees.",
      performSave,
      { title: "Save changes", confirmLabel: "Yes", cancelLabel: "No" }
    );
  }

  // The actual server write. Only reached via saveChanges() -> confirm Yes.
  async function performSave() {
    if (!editMode || saving || !dirty) return;
    const pw = getPassword();
    if (!pw) {
      // Lost the session password somehow — can't save; force re-unlock but
      // keep the in-memory edits intact (do NOT discard silently).
      setSaveStatus("error", "Session expired — unlock again to save.");
      lockWithoutSaving();
      renderAll();
      return;
    }
    saving = true;
    setSaveStatus("saving", "Saving…");
    updateSaveButton();
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-edit-password": pw,
        },
        body: JSON.stringify(appData),
      });
      if (res.status === 401) {
        setSaveStatus("error", "Password rejected — unlock again to save.");
        lockWithoutSaving();
        renderAll();
        return;
      }
      if (!res.ok) {
        let msg = `Save failed (HTTP ${res.status}).`;
        try {
          const e = await res.json();
          if (e && e.error) msg = e.error;
        } catch {}
        setSaveStatus("error", msg);
        return;
      }
      // Success: the server now matches our in-memory league. Mark it clean.
      markSavedSnapshot();
      setSaveStatus("ok", "Saved ✓");
    } catch (err) {
      setSaveStatus("error", "Network error — not saved.");
    } finally {
      saving = false;
      updateSaveButton();
    }
  }

  function setSaveStatus(kind, msg) {
    const node = $("#save-status");
    node.textContent = msg || "";
    node.className = "save-status " + (kind || "");
  }

  function updateSaveButton() {
    const btn = $("#btn-save");
    if (!btn) return;
    const canSave = editMode && dirty && !saving && backendOk;
    btn.disabled = !canSave;
    btn.style.display = editMode ? "" : "none";
  }

  // --- offline / error banner ------------------------------------------------

  function showOfflineBanner() {
    const b = $("#offline-banner");
    b.innerHTML =
      '<span class="icon">⚠</span><strong>Live data unavailable.</strong> ' +
      "This board reads and saves through a Netlify Function, which only runs " +
      "on the deployed site. Opening <code>index.html</code> directly shows " +
      "placeholder data and cannot save. Deploy to Netlify to use it for real.";
    b.classList.add("show");
  }
  function hideBanner() {
    $("#offline-banner").classList.remove("show");
  }

  // --- password / mode toggle ------------------------------------------------

  function enterEditMode() {
    const pwInput = el("input", { type: "password", placeholder: "Edit password" });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Password" }), pwInput]),
      el("div", {
        class: "hint",
        text: "The password is verified on the server and kept only for this browser tab.",
      }),
    ]);
    openModal("Unlock editing", body, async () => {
      const pw = pwInput.value;
      if (!pw) return setModalError("Enter the edit password.");
      if (!backendOk) {
        return setModalError("Editing needs the live site — deploy to Netlify first.");
      }
      setModalError("Checking…");
      try {
        const res = await fetch(`${API}?check=1`, {
          headers: { "x-edit-password": pw },
        });
        if (res.status === 200) {
          setPassword(pw); // sessionStorage, this tab only
          editMode = true;
          document.body.classList.add("edit-mode");
          updateModeUI();
          closeModal();
          renderAll();
          setSaveStatus("", "");
        } else if (res.status === 401) {
          setModalError("Incorrect password.");
        } else {
          let msg = `Server error (HTTP ${res.status}).`;
          try {
            const e = await res.json();
            if (e && e.error) msg = e.error;
          } catch {}
          setModalError(msg);
        }
      } catch (err) {
        setModalError("Could not reach the server.");
      }
    });
    setTimeout(() => pwInput.focus(), 50);
    pwInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onConfirm && onConfirm();
    });
  }

  // Lock button handler. With unsaved edits, confirm a discard first; on Yes
  // the in-memory edits are reverted to the last server-matching state so
  // nothing stale is left behind.
  function exitEditMode() {
    if (!editMode) return;
    if (dirty) {
      confirmDialog(
        "You have unsaved changes. Exit without saving? Your edits will be lost.",
        () => {
          revertToSnapshot(); // restore the last server-matching state
          lockWithoutSaving();
          renderAll();
        },
        { title: "Discard changes", confirmLabel: "Yes", cancelLabel: "No", confirmClass: "danger-solid" }
      );
      return;
    }
    lockWithoutSaving();
    renderAll();
  }

  // Drop to read-only without prompting and without saving. Leaves the current
  // in-memory league untouched (callers revert first if a discard is intended).
  function lockWithoutSaving() {
    editMode = false;
    clearPassword(); // forget the password for this tab
    document.body.classList.remove("edit-mode");
    updateModeUI();
    updateSaveButton();
    // If we were on an edit-only tab (Race Entry), fall back to a public one.
    const active = $(".tab.active");
    if (active && active.classList.contains("edit-only")) switchTab("drivers");
  }

  function updateModeUI() {
    const badge = $("#mode-badge");
    badge.textContent = editMode ? "Edit mode" : "Read-only";
    badge.classList.toggle("edit", editMode);
    $("#btn-edit").style.display = editMode ? "none" : "";
    $("#btn-lock").style.display = editMode ? "" : "none";
    updateSaveButton();
  }

  // --- tabs ------------------------------------------------------------------

  function switchTab(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === name + "-view"));
  }

  // --- seasons ---------------------------------------------------------------

  // Populate the season dropdown to reflect appData. The select shows the
  // active season; switching it is a view-only change (no edit/save required).
  function renderSeasonControl() {
    const select = $("#season-select");
    select.innerHTML = "";
    for (const season of appData.seasons) {
      select.appendChild(
        el("option", {
          value: season.id,
          text: season.name,
          ...(season.id === appData.activeSeasonId ? { selected: "selected" } : {}),
        })
      );
    }
  }

  function switchSeason(seasonId) {
    if (!appData.seasons.some((s) => s.id === seasonId)) return;
    appData.activeSeasonId = seasonId;
    pointLeagueAtActiveSeason();
    renderAll(); // re-render every tab with the newly active season's data
  }

  function addSeason() {
    const nameInput = el("input", {
      type: "text",
      placeholder: "Season name",
      value: `Season ${appData.seasons.length + 1}`,
    });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Season name" }), nameInput]),
      el("div", { class: "hint", text: "Starts empty — no teams, drivers, or races." }),
    ]);
    openModal("Add season", body, () => {
      const name = nameInput.value.trim();
      if (!name) return setModalError("Name is required.");
      const season = emptySeason(uid("season"), name);
      appData.seasons.push(season);
      appData.activeSeasonId = season.id; // switch to the new season
      pointLeagueAtActiveSeason();
      markDirty();
      closeModal();
      renderAll();
    });
  }

  function renameSeason() {
    const nameInput = el("input", { type: "text", value: league.name });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Season name" }), nameInput]),
    ]);
    openModal("Rename season", body, () => {
      const name = nameInput.value.trim();
      if (!name) return setModalError("Name is required.");
      league.name = name;
      markDirty();
      closeModal();
      renderAll();
    });
  }

  // --- All-Time / career standings (read-only, combined across seasons) ------

  // Sum a numeric stat per key (driver name or team name) across all seasons,
  // tracking how many distinct seasons each key appeared in.
  function allTimeDriverStandings() {
    const byName = new Map(); // name -> { name, points, seasonIds:Set }
    for (const season of appData.seasons) {
      for (const driver of season.drivers) {
        const pts = WSS.driverPoints(driver.id, season.results, season.races);
        const entry =
          byName.get(driver.name) || { name: driver.name, points: 0, seasonIds: new Set() };
        entry.points += pts;
        entry.seasonIds.add(season.id);
        byName.set(driver.name, entry);
      }
    }
    return [...byName.values()]
      .map((e) => ({ name: e.name, points: e.points, seasons: e.seasonIds.size }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
  }

  function allTimeTeamStandings() {
    const byName = new Map();
    for (const season of appData.seasons) {
      for (const team of season.teams) {
        const pts = WSS.teamPoints(team.id, season.results, season.drivers, season.races);
        const entry =
          byName.get(team.name) || { name: team.name, points: 0, seasonIds: new Set() };
        entry.points += pts;
        entry.seasonIds.add(season.id);
        byName.set(team.name, entry);
      }
    }
    return [...byName.values()]
      .map((e) => ({ name: e.name, points: e.points, seasons: e.seasonIds.size }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
  }

  function renderAllTime() {
    const driverBody = $("#alltime-driver-board tbody");
    const teamBody = $("#alltime-team-board tbody");
    driverBody.innerHTML = "";
    teamBody.innerHTML = "";

    const drivers = allTimeDriverStandings();
    if (drivers.length === 0) {
      driverBody.appendChild(
        el("tr", {}, [el("td", { colspan: 4, class: "empty-cell", text: "No drivers yet." })])
      );
    } else {
      drivers.forEach((entry, i) => {
        driverBody.appendChild(
          el("tr", { class: podiumClass(i) }, [
            el("td", { class: "col-pos num", text: String(i + 1) }),
            el("td", { class: "name-cell", text: entry.name }),
            el("td", { class: "col-num num", text: String(entry.seasons) }),
            el("td", { class: "col-pts num", text: String(entry.points) }),
          ])
        );
      });
    }

    const teams = allTimeTeamStandings();
    if (teams.length === 0) {
      teamBody.appendChild(
        el("tr", {}, [el("td", { colspan: 4, class: "empty-cell", text: "No teams yet." })])
      );
    } else {
      teams.forEach((entry, i) => {
        teamBody.appendChild(
          el("tr", { class: podiumClass(i) }, [
            el("td", { class: "col-pos num", text: String(i + 1) }),
            el("td", { class: "name-cell", text: entry.name }),
            el("td", { class: "col-num num", text: String(entry.seasons) }),
            el("td", { class: "col-pts num", text: String(entry.points) }),
          ])
        );
      });
    }
  }

  // --- render all ------------------------------------------------------------

  function renderAll() {
    renderSeasonControl();
    renderGrid();
    renderDriverBoard();
    renderTeamBoard();
    renderStageCards();
    renderPenaltyBoard();
    renderAllTime();
  }

  // --- init ------------------------------------------------------------------

  function init() {
    // tabs
    $$(".tab").forEach((t) =>
      t.addEventListener("click", () => switchTab(t.dataset.view))
    );

    // auth + save
    $("#btn-edit").addEventListener("click", enterEditMode);
    $("#btn-lock").addEventListener("click", exitEditMode);
    $("#btn-save").addEventListener("click", saveChanges);

    // editor toolbar
    $("#btn-add-team").addEventListener("click", openAddTeam);
    $("#btn-add-driver").addEventListener("click", openAddDriver);
    $("#btn-add-race").addEventListener("click", openAddRace);
    $("#btn-add-penalty").addEventListener("click", () => openEditPenalty(null));

    // Race Grid sort (view-only; not persisted)
    $("#grid-sort").addEventListener("change", (e) => {
      gridSort = e.target.value;
      renderGrid();
    });

    // Season control: switch (everyone), add/rename (edit mode only)
    $("#season-select").addEventListener("change", (e) => switchSeason(e.target.value));
    $("#btn-add-season").addEventListener("click", addSeason);
    $("#btn-rename-season").addEventListener("click", renameSeason);

    // modal backdrop click to close
    $("#modal-backdrop").addEventListener("click", (e) => {
      if (e.target === $("#modal-backdrop")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    // Warn before leaving with unsaved edits.
    window.addEventListener("beforeunload", (e) => {
      if (editMode && dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    updateModeUI();
    switchTab("grid"); // master grid is the primary view
    // Fetch from the backend; renders happen inside loadLeague.
    loadLeague();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
