"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// scoring.js is a UMD module that the browser loads as a plain <script>. Under
// "type": "module" we can't require() a .js file, so we evaluate it in a
// sandbox here. This keeps public/scoring.js as the single source of truth used
// unmodified by both the browser and these tests.
function loadScoring() {
  const code = fs.readFileSync(path.join(__dirname, "../public/scoring.js"), "utf8");
  const sandbox = { module: { exports: {} }, self: {} };
  sandbox.module.exports = {};
  vm.runInNewContext(code, sandbox);
  return sandbox.module.exports && Object.keys(sandbox.module.exports).length
    ? sandbox.module.exports
    : sandbox.self.WSS;
}
const WSS = loadScoring();

// --- pointsForResult ---------------------------------------------------------

test("pointsForResult maps the fixed table exactly", () => {
  const expected = {
    1: 36, 2: 26, 3: 22, 4: 18, 5: 15, 6: 12,
    7: 9, 8: 7, 9: 5, 10: 3, 11: 2, 12: 1,
  };
  for (const [pos, pts] of Object.entries(expected)) {
    assert.equal(
      WSS.pointsForResult({ position: Number(pos), status: "finished" }),
      pts,
      `P${pos} should be ${pts}`
    );
  }
});

test("pointsForResult gives 0 for P13 and worse", () => {
  assert.equal(WSS.pointsForResult({ position: 13, status: "finished" }), 0);
  assert.equal(WSS.pointsForResult({ position: 25, status: "finished" }), 0);
});

test("pointsForResult: DNF and DSQ always score 0 regardless of position", () => {
  assert.equal(WSS.pointsForResult({ position: 1, status: "dnf" }), 0);
  assert.equal(WSS.pointsForResult({ position: 1, status: "dsq" }), 0);
  assert.equal(WSS.pointsForResult({ position: 3, status: "dnf" }), 0);
});

test("pointsForResult: null / missing position scores 0", () => {
  assert.equal(WSS.pointsForResult({ position: null, status: "finished" }), 0);
  assert.equal(WSS.pointsForResult(null), 0);
  assert.equal(WSS.pointsForResult(undefined), 0);
  assert.equal(WSS.pointsForResult({ position: 0, status: "finished" }), 0);
});

// --- fixture -----------------------------------------------------------------

function fixture() {
  const drivers = [
    { id: "d1", teamId: "t1" },
    { id: "d2", teamId: "t1" },
    { id: "d3", teamId: "t1" },
    { id: "d4", teamId: "t2" },
  ];
  const races = [{ id: "r1" }, { id: "r2" }];
  const results = {
    // Race 1
    d1_r1: { position: 1, status: "finished", teamRace: true }, // 36, team
    d2_r1: { position: 3, status: "finished", teamRace: true }, // 22, team
    d3_r1: { position: 5, status: "finished", teamRace: false }, // 15, indep
    d4_r1: { position: 2, status: "finished", teamRace: true }, // 26, team (t2)
    // Race 2 — d1 now independent, d3 now team (per-race flip)
    d1_r2: { position: 4, status: "finished", teamRace: false }, // 18, indep
    d2_r2: { position: 2, status: "finished", teamRace: true }, // 26, team
    d3_r2: { position: 6, status: "finished", teamRace: true }, // 12, team
    d4_r2: { position: 1, status: "dnf", teamRace: true }, // 0 (dnf)
  };
  return { drivers, races, results };
}

// --- driverPoints ------------------------------------------------------------

test("driverPoints sums every race for the driver, ignoring teamRace flag", () => {
  const { results } = fixture();
  assert.equal(WSS.driverPoints("d1", results), 36 + 18); // 54
  assert.equal(WSS.driverPoints("d2", results), 22 + 26); // 48
  assert.equal(WSS.driverPoints("d3", results), 15 + 12); // 27
  assert.equal(WSS.driverPoints("d4", results), 26 + 0); // 26 (dnf race 2)
});

test("driverPoints prefix match does not bleed across similar ids", () => {
  const results = {
    d1_r1: { position: 1, status: "finished", teamRace: true }, // 36
    d10_r1: { position: 2, status: "finished", teamRace: true }, // 26
  };
  assert.equal(WSS.driverPoints("d1", results), 36);
  assert.equal(WSS.driverPoints("d10", results), 26);
});

// --- teamPointsForRace / teamPoints -----------------------------------------

test("teamPointsForRace sums only teamRace:true drivers on that team", () => {
  const { drivers, results } = fixture();
  // t1 race1: d1(36,team) + d2(22,team), d3 is independent -> 58
  assert.equal(WSS.teamPointsForRace("t1", "r1", results, drivers), 58);
  // t1 race2: d1 independent, d2(26,team) + d3(12,team) -> 38
  assert.equal(WSS.teamPointsForRace("t1", "r2", results, drivers), 38);
});

test("teamPoints sums across all races; per-race flag flips honored", () => {
  const { drivers, races, results } = fixture();
  assert.equal(WSS.teamPoints("t1", results, drivers, races), 58 + 38); // 96
  // t2: d4 26 (race1, team) + 0 (race2 dnf) -> 26
  assert.equal(WSS.teamPoints("t2", results, drivers, races), 26);
});

test("teamRace:false never contributes regardless of finish", () => {
  const drivers = [{ id: "d1", teamId: "t1" }];
  const races = [{ id: "r1" }];
  const results = {
    d1_r1: { position: 1, status: "finished", teamRace: false }, // P1 but independent
  };
  assert.equal(WSS.teamPoints("t1", results, drivers, races), 0);
  assert.equal(WSS.driverPoints("d1", results), 36); // still counts for the driver
});

// --- validation: over-limit team flags --------------------------------------

test("overLimitTeamRaces flags 3+ team-scoring drivers in one race", () => {
  const drivers = [
    { id: "d1", teamId: "t1" },
    { id: "d2", teamId: "t1" },
    { id: "d3", teamId: "t1" },
  ];
  const races = [{ id: "r1" }, { id: "r2" }];
  const results = {
    d1_r1: { position: 1, status: "finished", teamRace: true },
    d2_r1: { position: 2, status: "finished", teamRace: true },
    d3_r1: { position: 3, status: "finished", teamRace: true }, // 3rd team driver
    d1_r2: { position: 1, status: "finished", teamRace: true },
    d2_r2: { position: 2, status: "finished", teamRace: false },
  };
  const warnings = WSS.overLimitTeamRaces(results, drivers, races);
  assert.equal(warnings.length, 1);
  // Field-by-field (deepStrictEqual is realm-sensitive; the warning object is
  // created inside the vm sandbox where scoring.js is evaluated).
  assert.equal(warnings[0].teamId, "t1");
  assert.equal(warnings[0].raceId, "r1");
  assert.equal(warnings[0].count, 3);
  assert.equal(WSS.isTeamRaceOverLimit("t1", "r1", results, drivers), true);
  assert.equal(WSS.isTeamRaceOverLimit("t1", "r2", results, drivers), false);
});

test("over-limit still computes/saves the data — never auto-fixes", () => {
  const drivers = [
    { id: "d1", teamId: "t1" },
    { id: "d2", teamId: "t1" },
    { id: "d3", teamId: "t1" },
  ];
  const races = [{ id: "r1" }];
  const results = {
    d1_r1: { position: 1, status: "finished", teamRace: true }, // 36
    d2_r1: { position: 2, status: "finished", teamRace: true }, // 26
    d3_r1: { position: 3, status: "finished", teamRace: true }, // 22
  };
  // All three count — the function does not cap at 2.
  assert.equal(WSS.teamPoints("t1", results, drivers, races), 36 + 26 + 22);
});

// --- standings ---------------------------------------------------------------

test("driverStandings sorts high to low", () => {
  const { drivers, results } = fixture();
  const standings = WSS.driverStandings(drivers, results);
  assert.deepEqual(
    standings.map((s) => s.driver.id),
    ["d1", "d2", "d3", "d4"] // 54, 48, 27, 26
  );
});

test("teamStandings sorts high to low", () => {
  const { drivers, races, results } = fixture();
  const teams = [{ id: "t1" }, { id: "t2" }];
  const standings = WSS.teamStandings(teams, results, drivers, races);
  assert.deepEqual(
    standings.map((s) => s.team.id),
    ["t1", "t2"] // 96, 26
  );
});
