/*
 * Integration tests for the standings Netlify Function.
 *
 * @netlify/blobs is mocked (see test/mocks/) via an import map passed through
 * NODE_OPTIONS in the npm script, so getStore() returns an in-memory store.
 * Run through: node --test (the loader is registered by run-function-tests).
 *
 * This file is executed by test/run-function-tests.mjs, which installs the
 * mock loader. Running it directly without that loader will fail to resolve
 * @netlify/blobs's getStore as a stub — that's expected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { __resetStore } from "@netlify/blobs";
import handler from "../netlify/functions/standings.js";

const PW = "secret-pw";

function req(method, { path = "/.netlify/functions/standings", headers = {}, body } = {}) {
  const url = `http://localhost${path}`;
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(url, init);
}

function validLeague(extra = {}) {
  return {
    title: "T",
    teams: [],
    drivers: [],
    races: [],
    results: {},
    penalties: [],
    stages: [],
    ...extra,
  };
}

test.beforeEach(() => {
  __resetStore();
  process.env.EDIT_PASSWORD = PW;
});

test("GET returns an empty default league when nothing saved", async () => {
  const res = await handler(req("GET"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.league.teams, []);
  assert.deepEqual(body.league.drivers, []);
  assert.deepEqual(body.league.races, []);
  assert.deepEqual(body.league.results, {});
  assert.deepEqual(body.league.penalties, []);
});

test("GET ?check=1 with correct password -> 200", async () => {
  const res = await handler(
    req("GET", { path: "/.netlify/functions/standings?check=1", headers: { "x-edit-password": PW } })
  );
  assert.equal(res.status, 200);
});

test("GET ?check=1 with wrong password -> 401", async () => {
  const res = await handler(
    req("GET", { path: "/.netlify/functions/standings?check=1", headers: { "x-edit-password": "nope" } })
  );
  assert.equal(res.status, 401);
});

test("GET ?check=1 with no password -> 401", async () => {
  const res = await handler(req("GET", { path: "/.netlify/functions/standings?check=1" }));
  assert.equal(res.status, 401);
});

test("POST with correct password + valid body saves; GET reads it back", async () => {
  const league = validLeague({ title: "Saved Season", teams: [{ id: "t1", name: "A", color: "#fff" }] });
  const res = await handler(
    req("POST", { headers: { "x-edit-password": PW }, body: league })
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const read = await handler(req("GET"));
  const body = await read.json();
  assert.equal(body.league.title, "Saved Season");
  assert.equal(body.league.teams[0].name, "A");
});

test("POST accepts a { league } envelope too", async () => {
  const res = await handler(
    req("POST", { headers: { "x-edit-password": PW }, body: { league: validLeague({ title: "Env" }) } })
  );
  assert.equal(res.status, 200);
  const read = await handler(req("GET"));
  assert.equal((await read.json()).league.title, "Env");
});

test("POST with wrong password -> 401, nothing saved", async () => {
  const res = await handler(
    req("POST", { headers: { "x-edit-password": "wrong" }, body: validLeague({ title: "Hacked" }) })
  );
  assert.equal(res.status, 401);
  const read = await handler(req("GET"));
  assert.notEqual((await read.json()).league.title, "Hacked");
});

test("POST with missing required arrays -> 400", async () => {
  const bad = validLeague();
  delete bad.drivers;
  const res = await handler(req("POST", { headers: { "x-edit-password": PW }, body: bad }));
  assert.equal(res.status, 400);
});

test("POST with results as array (not object) -> 400", async () => {
  const res = await handler(
    req("POST", { headers: { "x-edit-password": PW }, body: validLeague({ results: [] }) })
  );
  assert.equal(res.status, 400);
});

test("POST with non-JSON body -> 400", async () => {
  const res = await handler(req("POST", { headers: { "x-edit-password": PW }, body: "not json{" }));
  assert.equal(res.status, 400);
});

test("when EDIT_PASSWORD unset, check and save are refused", async () => {
  delete process.env.EDIT_PASSWORD;
  const check = await handler(
    req("GET", { path: "/.netlify/functions/standings?check=1", headers: { "x-edit-password": "x" } })
  );
  assert.equal(check.status, 500);
  const save = await handler(req("POST", { headers: { "x-edit-password": "x" }, body: validLeague() }));
  assert.equal(save.status, 500);
});

test("unsupported method -> 405", async () => {
  const res = await handler(req("DELETE"));
  assert.equal(res.status, 405);
});
