/*
 * Realistic placeholder data. The deployed app loads real data from the
 * Netlify Function; this seed is only used as a read-only FALLBACK when the
 * function is unreachable (e.g. opening index.html directly off disk) so the
 * boards demo correctly instead of showing a blank screen. It is never saved.
 *
 * Mixed team/independent flags across races, one locked driver, one team with
 * 3 drivers (to exercise the over-limit warning), and a DNF/DSQ.
 * Shape matches the league data model exactly (see README).
 */
(function (root) {
  const placeholderLeague = {
    title: "World Sim Series — Season 1",
    teams: [
      { id: "t-apex", name: "Apex Dynamics", color: "#e10600" },
      { id: "t-meridian", name: "Meridian Racing", color: "#00b2ff" },
      { id: "t-nocturne", name: "Nocturne GP", color: "#ffb000" },
    ],
    drivers: [
      // Apex Dynamics (2 drivers)
      { id: "d-vega", name: "L. Vega", teamId: "t-apex", number: 7, locked: false },
      { id: "d-ito", name: "K. Ito", teamId: "t-apex", number: 14, locked: false },
      // Meridian Racing (3 drivers — exercises the 2-per-race team rule)
      { id: "d-rourke", name: "S. Rourke", teamId: "t-meridian", number: 3, locked: false },
      { id: "d-bauer", name: "M. Bauer", teamId: "t-meridian", number: 21, locked: false },
      { id: "d-haas", name: "T. Haas", teamId: "t-meridian", number: 44, locked: true },
      // Nocturne GP (2 drivers)
      { id: "d-okafor", name: "D. Okafor", teamId: "t-nocturne", number: 9, locked: false },
      { id: "d-lindqvist", name: "E. Lindqvist", teamId: "t-nocturne", number: 27, locked: false },
    ],
    races: [
      // locked: per-race column lock (results frozen behind a confirm). Optional;
      // absent/false means unlocked.
      { id: "r1", label: "R1", kind: "race", locked: false },
      { id: "r2", label: "R2", kind: "race", locked: false },
      { id: "r2s", label: "R2 Sprint", kind: "sprint", locked: false },
      { id: "r3", label: "R3", kind: "race", locked: true },
      { id: "r4", label: "R4", kind: "race", locked: false },
    ],
    results: {
      // --- R1 ---
      "d-vega_r1": { position: 1, status: "finished", teamRace: true, fastestLap: true },
      "d-ito_r1": { position: 5, status: "finished", teamRace: true },
      "d-rourke_r1": { position: 2, status: "finished", teamRace: true },
      "d-bauer_r1": { position: 8, status: "finished", teamRace: true },
      "d-haas_r1": { position: 11, status: "finished", teamRace: false }, // independent
      "d-okafor_r1": { position: 3, status: "finished", teamRace: true },
      "d-lindqvist_r1": { position: 4, status: "dnf", teamRace: true }, // dnf -> 0

      // --- R2 ---
      "d-vega_r2": { position: 3, status: "finished", teamRace: true },
      "d-ito_r2": { position: 1, status: "finished", teamRace: true },
      "d-rourke_r2": { position: 2, status: "finished", teamRace: true },
      "d-bauer_r2": { position: 6, status: "finished", teamRace: true },
      "d-okafor_r2": { position: 4, status: "finished", teamRace: true },
      "d-lindqvist_r2": { position: 7, status: "finished", teamRace: true },

      // --- R2 Sprint --- (flags flip vs R1 in places)
      "d-vega_r2s": { position: 4, status: "finished", teamRace: true },
      "d-ito_r2s": { position: 2, status: "finished", teamRace: false }, // now independent
      "d-rourke_r2s": { position: 1, status: "finished", teamRace: true },
      "d-bauer_r2s": { position: 6, status: "finished", teamRace: true },
      "d-haas_r2s": { position: 9, status: "finished", teamRace: false },
      "d-okafor_r2s": { position: 3, status: "finished", teamRace: true },
      "d-lindqvist_r2s": { position: 7, status: "finished", teamRace: true },

      // --- R3 --- (partial entry; a DSQ)
      "d-vega_r3": { position: 2, status: "finished", teamRace: true },
      "d-ito_r3": { position: 3, status: "finished", teamRace: true },
      "d-rourke_r3": { position: 1, status: "dsq", teamRace: true }, // dsq -> 0
      "d-bauer_r3": { position: 5, status: "finished", teamRace: true },
      "d-okafor_r3": { position: 4, status: "finished", teamRace: true },

      // --- R4 ---
      "d-vega_r4": { position: 1, status: "finished", teamRace: true },
      "d-ito_r4": { position: 4, status: "finished", teamRace: true },
      "d-rourke_r4": { position: 2, status: "finished", teamRace: true },
      "d-okafor_r4": { position: 3, status: "finished", teamRace: true },
      "d-lindqvist_r4": { position: 6, status: "finished", teamRace: true },
    },
    penalties: [
      {
        id: "p1",
        driverId: "d-rourke",
        points: 0,
        qualiBan: false,
        qualiBan2: false,
        raceBan: false,
        seasonBan: false,
        note: "Track limits warning (R1)",
      },
      {
        id: "p2",
        driverId: "d-bauer",
        points: 3,
        qualiBan: true,
        qualiBan2: false,
        raceBan: false,
        seasonBan: false,
        note: "Causing a collision (R2 Sprint)",
      },
      {
        id: "p3",
        driverId: "d-haas",
        points: 8,
        qualiBan: false,
        qualiBan2: true,
        raceBan: true,
        seasonBan: true,
        note: "Repeated unsafe rejoins (R3)",
      },
    ],
    // Stage standings are computed automatically from race results
    // (see WSS.stageStandings) — no manual stage data.
  };

  // Season 1 = the rich placeholder above. Give it an id + name.
  const season1 = Object.assign(
    { id: "season-1", name: "Season 1" },
    placeholderLeague
  );

  // A small, independent Season 2 with its OWN roster. Note some driver/team
  // NAMES repeat across seasons (L. Vega, K. Ito / Apex Dynamics, Nocturne GP)
  // — the All-Time tab combines those by name even though they're separate
  // records here.
  const season2 = {
    id: "season-2",
    name: "Season 2",
    title: "World Sim Series — Season 2",
    // Season 2 uses its OWN scoring (different from Season 1's defaults) to show
    // per-season point systems: a flatter table and a bigger fastest-lap bonus.
    pointsTable: {
      race: { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 },
      sprint: { 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 },
    },
    fastestLapBonus: { race: 3, sprint: 2 },
    teams: [
      { id: "s2-apex", name: "Apex Dynamics", color: "#e10600" },
      { id: "s2-nocturne", name: "Nocturne GP", color: "#ffb000" },
    ],
    drivers: [
      { id: "s2-vega", name: "L. Vega", teamId: "s2-apex", number: 7, locked: false },
      { id: "s2-ito", name: "K. Ito", teamId: "s2-apex", number: 14, locked: false },
      { id: "s2-okafor", name: "D. Okafor", teamId: "s2-nocturne", number: 9, locked: false },
      { id: "s2-park", name: "J. Park", teamId: "s2-nocturne", number: 5, locked: false },
    ],
    races: [
      { id: "s2r1", label: "R1", kind: "race", locked: false },
      { id: "s2r2", label: "R2", kind: "race", locked: false },
      { id: "s2r3", label: "R3", kind: "race", locked: false },
    ],
    results: {
      "s2-vega_s2r1": { position: 2, status: "finished", teamRace: true },
      "s2-ito_s2r1": { position: 1, status: "finished", teamRace: true, fastestLap: true },
      "s2-okafor_s2r1": { position: 3, status: "finished", teamRace: true },
      "s2-park_s2r1": { position: 4, status: "finished", teamRace: true },
      "s2-vega_s2r2": { position: 1, status: "finished", teamRace: true },
      "s2-ito_s2r2": { position: 3, status: "finished", teamRace: true },
      "s2-okafor_s2r2": { position: 2, status: "finished", teamRace: true },
      "s2-park_s2r2": { position: 5, status: "finished", teamRace: true },
      "s2-vega_s2r3": { position: 1, status: "finished", teamRace: true },
      "s2-okafor_s2r3": { position: 2, status: "finished", teamRace: true },
      "s2-park_s2r3": { position: 3, status: "finished", teamRace: true },
    },
    penalties: [],
  };

  const placeholderAppData = {
    activeSeasonId: "season-1",
    seasons: [season1, season2],
  };

  // Exposed name kept for back-compat; it now carries the appData wrapper, which
  // normalizeAppData() in app.js accepts directly.
  root.WSS_PLACEHOLDER_LEAGUE = placeholderAppData;
})(typeof self !== "undefined" ? self : this);
