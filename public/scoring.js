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
  // Fixed points table. Hardcoded by design — NOT editable from the UI.
  // Index 0 is unused so positions map 1:1 to array slots for readability.
  // P13 and worse score 0. Sprints use this identical table.
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

  // Max number of drivers a single team may flag teamRace:true for one race.
  const MAX_TEAM_DRIVERS_PER_RACE = 2;

  /**
   * Points scored for a single result row.
   * DNF and DSQ always score 0, regardless of finishing position.
   * A null/absent position scores 0 (no entry).
   * P13+ scores 0.
   *
   * @param {{position: number|null, status: string}|null|undefined} result
   * @returns {number}
   */
  function pointsForResult(result) {
    if (!result) return 0;
    if (result.status === "dnf" || result.status === "dsq") return 0;
    const pos = result.position;
    if (pos == null || !Number.isFinite(pos) || pos < 1) return 0;
    return POINTS_BY_POSITION[pos] || 0;
  }

  /**
   * Look up the result row for a driver in a race.
   * @returns {object|undefined}
   */
  function getResult(results, driverId, raceId) {
    return results ? results[`${driverId}_${raceId}`] : undefined;
  }

  /**
   * Total championship points for a driver: sum across EVERY result row for
   * that driver, across all races, regardless of the teamRace flag.
   * A driver's own total always counts every race they scored in.
   *
   * @param {string} driverId
   * @param {Object<string, object>} results
   * @returns {number}
   */
  function driverPoints(driverId, results) {
    if (!results) return 0;
    let total = 0;
    const suffix = `${driverId}_`;
    for (const key in results) {
      // Keys are `${driverId}_${raceId}`. Match on the driver prefix.
      // driverId never contains "_" in our id scheme, so a prefix check is safe.
      if (key.indexOf(suffix) === 0) {
        total += pointsForResult(results[key]);
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
   * @returns {number}
   */
  function teamPointsForRace(teamId, raceId, results, drivers) {
    let total = 0;
    for (const driver of drivers) {
      if (driver.teamId !== teamId) continue;
      const result = getResult(results, driver.id, raceId);
      if (result && result.teamRace === true) {
        total += pointsForResult(result);
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
      total += teamPointsForRace(teamId, race.id, results, drivers);
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
  function driverStandings(drivers, results) {
    return drivers
      .map((driver) => ({ driver, points: driverPoints(driver.id, results) }))
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

  return {
    POINTS_BY_POSITION,
    MAX_TEAM_DRIVERS_PER_RACE,
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
  };
});
