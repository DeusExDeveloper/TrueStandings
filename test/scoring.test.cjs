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

// --- sprint points table -----------------------------------------------------

test("pointsForPosition: main vs sprint tables", () => {
  // main (default / "race")
  assert.equal(WSS.pointsForPosition(1, "race"), 36);
  assert.equal(WSS.pointsForPosition(12, "race"), 1);
  assert.equal(WSS.pointsForPosition(13, "race"), 0);
  // sprint
  const sprint = { 1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };
  for (const [pos, pts] of Object.entries(sprint)) {
    assert.equal(WSS.pointsForPosition(Number(pos), "sprint"), pts, `sprint P${pos}`);
  }
  assert.equal(WSS.pointsForPosition(11, "sprint"), 0); // P11+ scores 0 in sprint
});

test("pointsForResult uses the sprint table when kind is sprint", () => {
  assert.equal(WSS.pointsForResult({ position: 1, status: "finished" }, "sprint"), 10);
  assert.equal(WSS.pointsForResult({ position: 10, status: "finished" }, "sprint"), 1);
  assert.equal(WSS.pointsForResult({ position: 11, status: "finished" }, "sprint"), 0);
  // omitted kind defaults to the main table (back-compat)
  assert.equal(WSS.pointsForResult({ position: 1, status: "finished" }), 36);
});

// --- fastest lap bonus -------------------------------------------------------

test("fastestLapBonus: +2 main, +1 sprint", () => {
  assert.equal(WSS.fastestLapBonus("race"), 2);
  assert.equal(WSS.fastestLapBonus("sprint"), 1);
});

test("fastest lap adds bonus on top of position points", () => {
  // main P1 + FL = 36 + 2 = 38
  assert.equal(
    WSS.pointsForResult({ position: 1, status: "finished", fastestLap: true }, "race"),
    38
  );
  // sprint P1 + FL = 10 + 1 = 11
  assert.equal(
    WSS.pointsForResult({ position: 1, status: "finished", fastestLap: true }, "sprint"),
    11
  );
});

test("fastest lap bonus applies even outside the points table", () => {
  // main P15 (0 position points) + FL = 0 + 2 = 2
  assert.equal(
    WSS.pointsForResult({ position: 15, status: "finished", fastestLap: true }, "race"),
    2
  );
});

test("fastest lap bonus still applies on a DNF", () => {
  // DNF = 0 position points, but FL bonus stands: main 0 + 2 = 2
  assert.equal(
    WSS.pointsForResult({ position: 3, status: "dnf", fastestLap: true }, "race"),
    2
  );
  // sprint DNF + FL = 0 + 1 = 1
  assert.equal(
    WSS.pointsForResult({ position: 3, status: "dnf", fastestLap: true }, "sprint"),
    1
  );
});

test("DSQ scores 0 total even with fastest lap flagged", () => {
  assert.equal(
    WSS.pointsForResult({ position: 1, status: "dsq", fastestLap: true }, "race"),
    0
  );
  assert.equal(
    WSS.pointsForResult({ position: 1, status: "dsq", fastestLap: true }, "sprint"),
    0
  );
});

test("driverPoints / teamPoints respect kind + fastest lap via races", () => {
  const drivers = [{ id: "d1", teamId: "t1" }];
  const races = [
    { id: "rm", kind: "race" },
    { id: "rs", kind: "sprint" },
  ];
  const results = {
    d1_rm: { position: 1, status: "finished", teamRace: true, fastestLap: true }, // 36+2=38
    d1_rs: { position: 1, status: "finished", teamRace: true, fastestLap: true }, // 10+1=11
  };
  assert.equal(WSS.driverPoints("d1", results, races), 49); // 38 + 11
  assert.equal(WSS.teamPoints("t1", results, drivers, races), 49);
});

// --- per-season scoring config -----------------------------------------------

test("defaultScoring returns the default tables + bonus", () => {
  const s = WSS.defaultScoring();
  assert.equal(s.pointsTable.race[1], 36);
  assert.equal(s.pointsTable.sprint[1], 10);
  assert.equal(s.fastestLapBonus.race, 2);
  assert.equal(s.fastestLapBonus.sprint, 1);
});

test("pointsForPosition reads a per-season scoring config", () => {
  const scoring = {
    pointsTable: { race: { 1: 40, 2: 30 }, sprint: { 1: 8 } },
    fastestLapBonus: { race: 5, sprint: 3 },
  };
  assert.equal(WSS.pointsForPosition(1, "race", scoring), 40);
  assert.equal(WSS.pointsForPosition(3, "race", scoring), 0); // not in table -> 0
  assert.equal(WSS.pointsForPosition(1, "sprint", scoring), 8);
  assert.equal(WSS.fastestLapBonus("race", scoring), 5);
  // omitting scoring falls back to defaults
  assert.equal(WSS.pointsForPosition(1, "race"), 36);
});

test("editing a season's P1 value changes every total that includes a P1", () => {
  const drivers = [{ id: "d1", teamId: "t1" }, { id: "d2", teamId: "t1" }];
  const races = [{ id: "r1", kind: "race" }];
  const results = {
    d1_r1: { position: 1, status: "finished", teamRace: true }, // P1
    d2_r1: { position: 3, status: "finished", teamRace: true }, // P3
  };
  const scoring = WSS.defaultScoring(); // P1=36, P3=22
  assert.equal(WSS.driverPoints("d1", results, races, scoring), 36);
  assert.equal(WSS.teamPoints("t1", results, drivers, races, scoring), 58); // 36 + 22

  // Mutate P1 36 -> 40 (mirrors editing the table live)
  scoring.pointsTable.race[1] = 40;
  assert.equal(WSS.driverPoints("d1", results, races, scoring), 40); // P1 now 40
  assert.equal(WSS.driverPoints("d2", results, races, scoring), 22); // P3 unchanged
  assert.equal(WSS.teamPoints("t1", results, drivers, races, scoring), 62); // 40 + 22
});

test("two seasons score the same result independently", () => {
  const result = { position: 1, status: "finished", fastestLap: true };
  const s1 = WSS.defaultScoring(); // P1=36, FL +2 -> 38
  const s2 = {
    pointsTable: { race: { 1: 25 } },
    fastestLapBonus: { race: 3 },
  }; // P1=25, FL +3 -> 28
  assert.equal(WSS.pointsForResult(result, "race", s1), 38);
  assert.equal(WSS.pointsForResult(result, "race", s2), 28);
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

// --- stages ------------------------------------------------------------------

// deepStrictEqual is realm-sensitive (scoring.js runs in a vm sandbox), so
// compare arrays returned straight from the module via a string join.
const join = (arr) => arr.join(",");

test("stageGroupSizes: even split", () => {
  assert.equal(join(WSS.stageGroupSizes(12)), "4,4,4");
  assert.equal(join(WSS.stageGroupSizes(3)), "1,1,1");
});

test("stageGroupSizes: remainder goes to earlier stages first", () => {
  assert.equal(join(WSS.stageGroupSizes(10)), "4,3,3"); // remainder 1
  assert.equal(join(WSS.stageGroupSizes(11)), "4,4,3"); // remainder 2
  assert.equal(join(WSS.stageGroupSizes(7)), "3,2,2");
});

test("assignRacesToStages: null when fewer than 3 main races", () => {
  assert.equal(WSS.assignRacesToStages([]), null);
  assert.equal(
    WSS.assignRacesToStages([
      { id: "r1", kind: "race" },
      { id: "s1", kind: "sprint" },
      { id: "r2", kind: "race" },
    ]),
    null
  ); // only 2 main races
});

test("assignRacesToStages: sprint grouped with preceding main race's stage", () => {
  // 3 main races -> [1,1,1]. R2 Sprint sits between main r2 and r3.
  const races = [
    { id: "r1", kind: "race" }, // Stage I
    { id: "r2", kind: "race" }, // Stage II
    { id: "r2s", kind: "sprint" }, // -> Stage II (follows r2)
    { id: "r3", kind: "race" }, // Stage III
  ];
  const stages = WSS.assignRacesToStages(races);
  assert.equal(join(stages[0].raceIds), "r1");
  assert.equal(join(stages[1].raceIds), "r2,r2s"); // sprint joined Stage II
  assert.equal(join(stages[2].raceIds), "r3");
});

test("assignRacesToStages: sprint before any main race joins the first stage", () => {
  const races = [
    { id: "s0", kind: "sprint" }, // no preceding main -> Stage I
    { id: "r1", kind: "race" },
    { id: "r2", kind: "race" },
    { id: "r3", kind: "race" },
  ];
  const stages = WSS.assignRacesToStages(races);
  assert.equal(join(stages[0].raceIds), "s0,r1");
  assert.equal(join(stages[1].raceIds), "r2");
  assert.equal(join(stages[2].raceIds), "r3");
});

test("stageStandings: null when not enough main races", () => {
  assert.equal(WSS.stageStandings([{ id: "r1", kind: "race" }], [], {}), null);
});

test("stageStandings: per-stage totals include sprint points in the right stage", () => {
  const races = [
    { id: "r1", kind: "race" }, // Stage I
    { id: "r2", kind: "race" }, // Stage II
    { id: "r2s", kind: "sprint" }, // Stage II
    { id: "r3", kind: "race" }, // Stage III
  ];
  const drivers = [{ id: "d1" }, { id: "d2" }];
  const results = {
    d1_r1: { position: 1, status: "finished", teamRace: true }, // S1: 36
    d1_r2: { position: 2, status: "finished", teamRace: true }, // S2: 26
    d1_r2s: { position: 1, status: "finished", teamRace: false }, // S2: 10 (sprint P1)
    d1_r3: { position: 5, status: "finished", teamRace: true }, // S3: 15
    d2_r1: { position: 2, status: "finished", teamRace: true }, // S1: 26
    d2_r3: { position: 1, status: "finished", teamRace: true }, // S3: 36
  };
  const stages = WSS.stageStandings(races, drivers, results);
  // Stage I: d1 36, d2 26
  assert.deepEqual(
    stages[0].standings.map((s) => `${s.driver.id}:${s.points}`),
    ["d1:36", "d2:26"]
  );
  // Stage II: d1 = 26 (r2 main) + 10 (r2s sprint P1) = 36; d2 absent (0)
  assert.deepEqual(
    stages[1].standings.map((s) => `${s.driver.id}:${s.points}`),
    ["d1:36"]
  );
  // Stage III: d2 36, d1 15
  assert.deepEqual(
    stages[2].standings.map((s) => `${s.driver.id}:${s.points}`),
    ["d2:36", "d1:15"]
  );
});

test("stageStandings: keeps only top 3 per stage", () => {
  const races = [
    { id: "r1", kind: "race" },
    { id: "r2", kind: "race" },
    { id: "r3", kind: "race" },
  ];
  // 4 drivers all scoring in Stage I (r1); only top 3 should be returned.
  const drivers = [{ id: "d1" }, { id: "d2" }, { id: "d3" }, { id: "d4" }];
  const results = {
    d1_r1: { position: 1, status: "finished", teamRace: true }, // 36
    d2_r1: { position: 2, status: "finished", teamRace: true }, // 26
    d3_r1: { position: 3, status: "finished", teamRace: true }, // 22
    d4_r1: { position: 4, status: "finished", teamRace: true }, // 18
  };
  const stages = WSS.stageStandings(races, drivers, results);
  assert.equal(stages[0].standings.length, 3);
  assert.deepEqual(
    stages[0].standings.map((s) => s.driver.id),
    ["d1", "d2", "d3"]
  );
});
