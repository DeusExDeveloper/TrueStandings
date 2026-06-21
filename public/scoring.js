/*
 * WSS Standings — pure scoring logic.
 *
 * This module is intentionally free of any DOM / rendering concerns so it can
 * be unit tested in Node and reused by the browser UI. It is loaded both as a
 * plain <script> in the browser (attaching to window.WSS) and as a CommonJS
 * module in the test runner.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api; // Node / test runner
  }
  root.WSS = api; // Browser global
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Fixed points tables. Hardcoded by design — NOT editable from the UI.
  // Positions map 1:1 to keys. Positions outside a table score 0.
  //   - Main races (kind "race"):  P1=36 … P12=1, P13+ = 0
  //   - Sprint races (kind "sprint"): P1=10 … P10=1, P11+ = 0
  // ---------------------------------------------------------------------------
  const POINTS_BY_POSITION = {
    1: 36,
    2: 26,
    3: 22,
    4: 18,
    5: 15,
    6: 12,
    7: 9,
    8: 7,
    9: 5,
    10: 3,
    11: 2,
    12: 1,
  };

  const SPRINT_POINTS_BY_POSITION = {
    1: 10,
    2: 9,
    3: 8,
    4: 7,
    5: 6,
    6: 5,
    7: 4,
    8: 3,
    9: 2,
    10: 1,
  };

  // Fastest-lap bonus, by race kind.
  const FASTEST_LAP_BONUS = { race: 2, sprint: 1 };

  // Max number of drivers a single team may flag teamRace:true for one race.
  const MAX_TEAM_DRIVERS_PER_RACE = 2;

  // Normalize an arbitrary kind value to "race" | "sprint" (default "race").
  function normalizeKind(raceKind) {
    return raceKind === "sprint" ? "sprint" : "race";
  }

  /**
   * Position points for a finishing position under the given race kind.
   * Picks the main or sprint table. Positions outside the table score 0.
   *
   * @param {number|null} position
   * @param {string} raceKind "race" | "sprint"
   * @returns {number}
   */
  function pointsForPosition(position, raceKind) {
    if (position == null || !Number.isFinite(position) || position < 1) return 0;
    const table =
      normalizeKind(raceKind) === "sprint" ? SPRINT_POINTS_BY_POSITION : POINTS_BY_POSITION;
    return table[position] || 0;
  }

  /**
   * Fastest-lap bonus for a race kind: +2 for a main race, +1 for a sprint.
   * @param {string} raceKind
   * @returns {number}
   */
  function fastestLapBonus(raceKind) {
    return FASTEST_LAP_BONUS[normalizeKind(raceKind)];
  }

  /**
   * Total points scored for a single result row, given its race kind.
   *
   *   total = (0 if DSQ, else pointsForPosition(position, kind))
   *         + (0 if DSQ, else fastestLapBonus(kind) when fastestLap is set)
   *
   * - DSQ scores 0 total — including no fastest-lap bonus.
   * - DNF scores 0 position points but STILL earns the fastest-lap bonus.
   * - The fastest-lap bonus applies regardless of finishing position (a driver
   *   outside the points table still gets it), except on a DSQ.
   *
   * @param {{position:number|null, status:string, fastestLap?:boolean}|null} result
   * @param {string} [raceKind] "race" | "sprint" (defaults to main race)
   * @returns {number}
   */
  function pointsForResult(result, raceKind) {
    if (!result) return 0;
    if (result.status === "dsq") return 0; // DSQ wipes everything, incl. bonus

    const kind = normalizeKind(raceKind);
    // DNF scores 0 position points but can still hold the fastest lap.
    const positionPoints = result.status === "dnf" ? 0 : pointsForPosition(result.position, kind);
    const bonus = result.fastestLap ? fastestLapBonus(kind) : 0;
    return positionPoints + bonus;
  }

  /**
   * Look up the result row for a driver in a race.
   * @returns {object|undefined}
   */
  function getResult(results, driverId, raceId) {
    return results ? results[`${driverId}_${raceId}`] : undefined;
  }

  /**
   * Build a { raceId: kind } map from a races array so the aggregate scorers
   * can pick the right points table per result. Unknown races default to main.
   *
   * @param {Array<{id:string, kind?:string}>} [races]
   * @returns {Object<string,string>}
   */
  function raceKindMap(races) {
    const map = {};
    if (Array.isArray(races)) {
      for (const r of races) map[r.id] = normalizeKind(r.kind);
    }
    return map;
  }

  // Extract the raceId from a result key `${driverId}_${raceId}`. driverIds and
  // raceIds in our scheme don't contain "_" in their middle except... ids are
  // generated as `${prefix}-${rand}` (no underscore), and seed ids like
  // "d-vega" / "r2s" have no underscore, so splitting on the LAST "_" is safe.
  function raceIdFromKey(key) {
    const idx = key.lastIndexOf("_");
    return idx === -1 ? "" : key.slice(idx + 1);
  }

  /**
   * Total championship points for a driver: sum across EVERY result row for
   * that driver, across all races, regardless of the teamRace flag.
   * A driver's own total always counts every race they scored in.
   *
   * Penalties are NOT deducted here — the Penalties board is informational only
   * and does not affect computed totals.
   *
   * @param {string} driverId
   * @param {Object<string, object>} results
   * @param {Array<{id:string, kind?:string}>} [races] needed to pick the sprint
   *        vs main points table per result; omitting it treats all as main.
   * @returns {number}
   */
  function driverPoints(driverId, results, races) {
    if (!results) return 0;
    const kinds = raceKindMap(races);
    let total = 0;
    const suffix = `${driverId}_`;
    for (const key in results) {
      // Keys are `${driverId}_${raceId}`. Match on the driver prefix.
      // driverId never contains "_" in our id scheme, so a prefix check is safe.
      if (key.indexOf(suffix) === 0) {
        total += pointsForResult(results[key], kinds[raceIdFromKey(key)]);
      }
    }
    return total;
  }

  /**
   * Points a team scored in ONE specific race.
   * Sums the points of every driver on the team whose result for that race is
   * flagged teamRace:true. The flag is trusted completely — never auto-picks
   * "the best N". Drivers flagged teamRace:false contribute nothing that race,
   * no matter how they finished.
   *
   * @param {string} teamId
   * @param {string} raceId
   * @param {Object<string, object>} results
   * @param {Array<{id:string, teamId:string}>} drivers
   * @param {string} [raceKind] "race" | "sprint" for the correct points table
   * @returns {number}
   */
  function teamPointsForRace(teamId, raceId, results, drivers, raceKind) {
    let total = 0;
    for (const driver of drivers) {
      if (driver.teamId !== teamId) continue;
      const result = getResult(results, driver.id, raceId);
      if (result && result.teamRace === true) {
        total += pointsForResult(result, raceKind);
      }
    }
    return total;
  }

  /**
   * Total championship points for a team: sum of teamPointsForRace across all
   * races. Only teamRace:true results count.
   *
   * @param {string} teamId
   * @param {Object<string, object>} results
   * @param {Array<{id:string, teamId:string}>} drivers
   * @param {Array<{id:string}>} races
   * @returns {number}
   */
  function teamPoints(teamId, results, drivers, races) {
    let total = 0;
    for (const race of races) {
      total += teamPointsForRace(teamId, race.id, results, drivers, race.kind);
    }
    return total;
  }

  /**
   * Count of drivers on a team flagged teamRace:true for a given race.
   * Used to drive the over-limit validation warning.
   *
   * @returns {number}
   */
  function teamRaceFlagCount(teamId, raceId, results, drivers) {
    let count = 0;
    for (const driver of drivers) {
      if (driver.teamId !== teamId) continue;
      const result = getResult(results, driver.id, raceId);
      if (result && result.teamRace === true) count += 1;
    }
    return count;
  }

  /**
   * Validation: which (teamId, raceId) combos have MORE than the allowed
   * number of team-scoring drivers. This is a WARNING surface only — scoring
   * never auto-fixes; it computes whatever the data says.
   *
   * @returns {Array<{teamId:string, raceId:string, count:number}>}
   */
  function overLimitTeamRaces(results, drivers, races, limit) {
    const max = limit == null ? MAX_TEAM_DRIVERS_PER_RACE : limit;
    const warnings = [];
    // Collect the distinct team ids present among drivers.
    const teamIds = [];
    for (const d of drivers) {
      if (d.teamId && teamIds.indexOf(d.teamId) === -1) teamIds.push(d.teamId);
    }
    for (const race of races) {
      for (const teamId of teamIds) {
        const count = teamRaceFlagCount(teamId, race.id, results, drivers);
        if (count > max) {
          warnings.push({ teamId, raceId: race.id, count });
        }
      }
    }
    return warnings;
  }

  /**
   * Is this specific (team, race) over the team-driver limit?
   * Convenience for the grid renderer.
   */
  function isTeamRaceOverLimit(teamId, raceId, results, drivers, limit) {
    const max = limit == null ? MAX_TEAM_DRIVERS_PER_RACE : limit;
    return teamRaceFlagCount(teamId, raceId, results, drivers) > max;
  }

  /**
   * Driver standings, sorted high to low by points. Ties keep input order
   * (stable), which callers may break further (e.g. by name) if desired.
   *
   * @returns {Array<{driver:object, points:number}>}
   */
  function driverStandings(drivers, results, races) {
    return drivers
      .map((driver) => ({ driver, points: driverPoints(driver.id, results, races) }))
      .sort((a, b) => b.points - a.points);
  }

  /**
   * Team standings, sorted high to low by points.
   *
   * @returns {Array<{team:object, points:number}>}
   */
  function teamStandings(teams, results, drivers, races) {
    return teams
      .map((team) => ({
        team,
        points: teamPoints(team.id, results, drivers, races),
      }))
      .sort((a, b) => b.points - a.points);
  }

  // The season is always divided into exactly 3 stages.
  const NUM_STAGES = 3;
  const STAGE_LABELS = ["Stage I", "Stage II", "Stage III"];

  /**
   * Split N main races into NUM_STAGES consecutive group sizes, with any
   * remainder distributed to the EARLIER stages first.
   * e.g. 10 -> [4, 3, 3]; 12 -> [4, 4, 4]; 7 -> [3, 2, 2].
   *
   * @param {number} mainCount
   * @returns {number[]} sizes per stage (length NUM_STAGES)
   */
  function stageGroupSizes(mainCount) {
    const base = Math.floor(mainCount / NUM_STAGES);
    let remainder = mainCount % NUM_STAGES;
    const sizes = [];
    for (let i = 0; i < NUM_STAGES; i++) {
      sizes.push(base + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder -= 1;
    }
    return sizes;
  }

  /**
   * Assign every race (main + sprint) to one of the 3 stages.
   *
   * Stages are carved up using MAIN races only (kind === "race"); the main
   * races, in season order, are split into 3 consecutive groups (remainder to
   * earlier stages). Each sprint is then attached to the stage of the nearest
   * MAIN race that precedes it in season order; if no main race precedes it, it
   * takes the stage of the nearest following main race.
   *
   * Returns null when there are fewer than NUM_STAGES main races (can't form 3
   * meaningful stages).
   *
   * @param {Array<{id:string, kind?:string}>} races season-ordered
   * @returns {null | Array<{index:number, label:string, raceIds:string[]}>}
   */
  function assignRacesToStages(races) {
    const list = Array.isArray(races) ? races : [];
    const mainRaces = list.filter((r) => r.kind !== "sprint");
    if (mainRaces.length < NUM_STAGES) return null;

    // stageOfMain: map each main race id -> stage index, via the group sizes.
    const sizes = stageGroupSizes(mainRaces.length);
    const stageOfMain = {};
    let cursor = 0;
    for (let s = 0; s < NUM_STAGES; s++) {
      for (let k = 0; k < sizes[s]; k++) {
        stageOfMain[mainRaces[cursor].id] = s;
        cursor += 1;
      }
    }

    const stages = STAGE_LABELS.map((label, index) => ({ index, label, raceIds: [] }));

    // Walk the season in order, tracking the stage of the last main race seen.
    let lastMainStage = null;
    // Index of the first main race's stage, for sprints that precede all mains.
    const firstMainStage = stageOfMain[mainRaces[0].id];

    for (const race of list) {
      let stageIdx;
      if (race.kind !== "sprint") {
        stageIdx = stageOfMain[race.id];
        lastMainStage = stageIdx;
      } else {
        // Sprint: nearest preceding main race's stage, else nearest following.
        stageIdx = lastMainStage != null ? lastMainStage : firstMainStage;
      }
      stages[stageIdx].raceIds.push(race.id);
    }

    return stages;
  }

  /**
   * Per-stage driver standings: each stage's top scorers, computed from race
   * points (main + sprint) of the races falling within that stage's span.
   * Uses the same points table as everywhere else — no special stage scoring.
   *
   * Returns null when there aren't enough main races to form 3 stages.
   *
   * @param {Array} races
   * @param {Array<{id:string}>} drivers
   * @param {Object<string,object>} results
   * @param {number} [topN] how many leaders to keep per stage (default 3)
   * @returns {null | Array<{index, label, standings: Array<{driver, points}>}>}
   */
  function stageStandings(races, drivers, results, topN) {
    const stages = assignRacesToStages(races);
    if (!stages) return null;
    const limit = topN == null ? 3 : topN;
    const kinds = raceKindMap(races);

    return stages.map((stage) => {
      const standings = (drivers || [])
        .map((driver) => {
          let points = 0;
          for (const raceId of stage.raceIds) {
            points += pointsForResult(getResult(results, driver.id, raceId), kinds[raceId]);
          }
          return { driver, points };
        })
        // Only drivers who actually scored in this stage are worth showing.
        .filter((entry) => entry.points > 0)
        .sort((a, b) => b.points - a.points)
        .slice(0, limit);
      return { index: stage.index, label: stage.label, standings };
    });
  }

  return {
    POINTS_BY_POSITION,
    SPRINT_POINTS_BY_POSITION,
    FASTEST_LAP_BONUS,
    MAX_TEAM_DRIVERS_PER_RACE,
    pointsForPosition,
    fastestLapBonus,
    pointsForResult,
    getResult,
    driverPoints,
    teamPointsForRace,
    teamPoints,
    teamRaceFlagCount,
    overLimitTeamRaces,
    isTeamRaceOverLimit,
    driverStandings,
    teamStandings,
    NUM_STAGES,
    stageGroupSizes,
    assignRacesToStages,
    stageStandings,
  };
});
