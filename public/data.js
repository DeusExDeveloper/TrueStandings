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
      { id: "r1", label: "R1", kind: "race" },
      { id: "r2s", label: "R2 Sprint", kind: "sprint" },
      { id: "r3", label: "R3", kind: "race" },
    ],
    results: {
      // --- R1 ---
      "d-vega_r1": { position: 1, status: "finished", teamRace: true },
      "d-ito_r1": { position: 5, status: "finished", teamRace: true },
      "d-rourke_r1": { position: 2, status: "finished", teamRace: true },
      "d-bauer_r1": { position: 8, status: "finished", teamRace: true },
      "d-haas_r1": { position: 11, status: "finished", teamRace: false }, // independent
      "d-okafor_r1": { position: 3, status: "finished", teamRace: true },
      "d-lindqvist_r1": { position: 4, status: "dnf", teamRace: true }, // dnf -> 0

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
    ],
    // Manual stage sub-tables (NOT computed from results — mirrors the
    // original spreadsheet). Each stage holds up to 3 manually typed
    // name + points rows.
    stages: [
      {
        id: "s1",
        label: "Stage I",
        rows: [
          { name: "L. Vega", points: 80 },
          { name: "S. Rourke", points: 62 },
          { name: "D. Okafor", points: 62 },
        ],
      },
      {
        id: "s2",
        label: "Stage II",
        rows: [
          { name: "", points: "" },
          { name: "", points: "" },
          { name: "", points: "" },
        ],
      },
      {
        id: "s3",
        label: "Stage III",
        rows: [
          { name: "", points: "" },
          { name: "", points: "" },
          { name: "", points: "" },
        ],
      },
    ],
  };

  root.WSS_PLACEHOLDER_LEAGUE = placeholderLeague;
})(typeof self !== "undefined" ? self : this);
