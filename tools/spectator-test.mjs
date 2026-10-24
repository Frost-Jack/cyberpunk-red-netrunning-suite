/* Zero-dependency spectator regressions: node tools/spectator-test.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const clone = (value) => JSON.parse(JSON.stringify(value));
const world = {};
const notices = [];
let serial = 0;
const users = new Map(["gm", "p", "ally", "other"].map((id) => [id, { id, name: id, isGM: id === "gm", getFlag: () => null }]));
users.filter = (fn) => [...users.values()].filter(fn);
const actors = new Map([["Actor.ally", { name: "Allied runner" }]]);
const game = {
  user: users.get("gm"), users, actors: new Map(),
  settings: {
    get: (_, key) => world[key],
    set: async (_, key, value) => { world[key] = clone(value); return world[key]; },
  },
  i18n: { localize: (key) => key, format: (key) => key },
};
class Application {
  constructor() {}
  render() {}
  static get defaultOptions() { return {}; }
}
const context = vm.createContext({
  console, game, Application,
  fromUuidSync: (id) => actors.get(id) || null,
  foundry: { utils: { deepClone: clone, randomID: () => String(++serial) } },
  ui: { notifications: { warn: (key) => notices.push(key) } },
  ChatMessage: { create: async () => ({}) },
});

// Execute the actual module bodies, replacing only Foundry/system imports.
function load(relative, imports = {}) {
  const path = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const source = readFileSync(path, "utf8");
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
  const body = source.replace(/^import .*;\r?$/gm, "")
    .replace(/export default class (\w+)/, (_, name) => { names.push(name); return `class ${name}`; })
    .replace(/\bexport\s+/g, "");
  return vm.runInContext(`(function(imports) { const {${Object.keys(imports).join(",")}} = imports;\n${body}\nreturn {${names.join(",")}}; })`, context, { filename: path })(imports);
}
const constants = load("scripts/constants.js");
const graphFns = load("scripts/topology.js");
const data = load("scripts/data.js", { ...constants, ...graphFns, bridge: { deleteEntityActors: async () => {} } });
const tabs = load("scripts/apps/tabs.js", {
  ...constants, ...data,
  mutate: (name, payload) => data.applyOp(name, payload, game.user.id),
});
const noop = { getData: () => ({}) };
const suite = load("scripts/apps/suite-app.js", {
  ...constants, ...data, userNetrunnerActor: () => null,
  Tree: noop, Tabs: tabs, Editor: noop, Canvas: noop, Runners: noop, Actions: noop, Help: noop, Equipment: noop, Content: noop,
});
const app = new suite.NetrunningSuiteApp();
const runner = (userId = "ally", archId = "a", extra = {}) => ({
  kind: "runner", userId, archId, jackedIn: true, actorUuid: "Actor.ally", ...extra,
});
function reset(extra = {}) {
  for (const key of Object.keys(world)) delete world[key];
  Object.assign(world, {
    netArchs: { a: { id: "a", name: "Alpha" }, b: { id: "b", name: "Beta" } },
    session: { participants: { ally: runner() } },
    allowSpectators: true, spectatorFreeMove: false,
  }, extra);
  game.user = users.get("p");
  app.state.watchOpen = false;
  app.state.selection = "";
}
const act = (name, payload) => data.applyOp(name, payload, "p");
const watch = (pid = "ally", archId = "a") => act("session.spectate", { userId: "p", archId, followPid: pid });
const mySpectators = () => Object.entries(world.session.participants)
  .filter(([, p]) => p.kind === "spectator" && p.userId === "p");
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`OK ${name}`); }

await test("Watch entry: new, roster, disconnected, connected; permission on/off", () => {
  for (const own of [null, runner("p", "", { jackedIn: false }), runner("p", "a", { jackedIn: false }), runner("p", "a")]) {
    for (const allow of [false, true]) {
      reset({ allowSpectators: allow });
      if (own) world.session.participants.own = clone(own);
      const view = tabs.getData(app).tabsWatch;
      assert.ok(view);
      assert.equal(view.permissionDenied, !allow);
      assert.equal(view.open, false);
      assert.equal(view.targets.find((t) => t.pid === "ally").disabled, !allow);
    }
  }
});

await test("target filtering and actor+architecture labels", () => {
  reset();
  Object.assign(world.session.participants, {
    gm: runner("gm"), npc: runner(""), out: runner("other", "a", { jackedIn: false }),
    stale: runner("other", "missing"), roster: runner("other", ""),
    s: { kind: "spectator", userId: "other", archId: "a" },
  });
  const targets = tabs.getData(app).tabsWatch.targets;
  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, "Allied runner");
  assert.equal(targets[0].archName, "Alpha");
});

await test("server permissions and no impersonation", async () => {
  reset({ allowSpectators: false });
  assert.equal((await watch()).error, "CRNS.Errors.SpectatorsDisabled");
  assert.equal(mySpectators().length, 0);
  assert.equal(await act("session.spectate", { userId: "other", archId: "a", followPid: "ally" }), false);
});

await test("initial entry works for every own-runner state with freeMove false", async () => {
  for (const own of [null, runner("p", "", { jackedIn: false }), runner("p", "a", { jackedIn: false }), runner("p", "b")]) {
    reset();
    if (own) world.session.participants.own = clone(own);
    assert.equal(await watch(), true);
    assert.equal(app.myParticipant().kind, "spectator");
    assert.equal(app.myParticipant().followPid, "ally");
    if (own) assert.deepEqual(world.session.participants.own, own);
  }
});

await test("legacy user-id slot collision preserves own runner", async () => {
  reset();
  const own = runner("p", "b");
  world.session.participants["user:p"] = clone(own);
  assert.equal(await watch(), true);
  assert.deepEqual(world.session.participants["user:p"], own);
  assert.notEqual(app.myParticipant().pid, "user:p");
});

await test("follow target must be an active player in the selected architecture", async () => {
  for (const bad of [runner("gm"), runner("other", "a", { jackedIn: false }), runner("other", "missing"), { kind: "spectator", userId: "other", archId: "a" }]) {
    reset();
    world.session.participants.bad = bad;
    assert.equal((await watch("bad")).error, "CRNS.Errors.SpectatorUnavailable");
    assert.equal(mySpectators().length, 0);
  }
  reset();
  assert.equal((await watch("missing")).error, "CRNS.Errors.SpectatorUnavailable");
  assert.equal((await watch("ally", "b")).error, "CRNS.Errors.SpectatorUnavailable");
});

await test("freeMove gates cross-architecture switches only", async () => {
  reset();
  world.session.participants.other = runner("other", "a");
  world.session.participants.remote = runner("other", "b");
  assert.equal(await watch(), true);
  assert.equal(await watch("other"), true);
  assert.equal((await watch("remote", "b")).error, "CRNS.Errors.SpectatorSwitchLocked");
  const targets = tabs.getData(app).tabsWatch.targets;
  assert.equal(targets.find((t) => t.pid === "other").disabled, false);
  assert.equal(targets.find((t) => t.pid === "remote").disabled, true);
  world.spectatorFreeMove = true;
  assert.equal(await watch("remote", "b"), true);
  assert.equal(app.myParticipant().archId, "b");
});

await test("leave returns to untouched own runner with permission disabled", async () => {
  reset();
  const own = runner("p", "b", { floorIndex: 3, actions: { value: 2, max: 3 } });
  world.session.participants.own = clone(own);
  await watch();
  world.allowSpectators = false;
  assert.equal(await act("session.disconnect", { pid: app.myParticipant().pid }), true);
  assert.equal(app.myParticipant().pid, "own");
  assert.deepEqual(world.session.participants.own, own);
});

await test("stale follow falls back to own runner, never another ally", async () => {
  reset();
  world.session.participants.own = runner("p", "b");
  world.session.participants.other = runner("other", "a");
  await watch();
  world.session.participants.ally.jackedIn = false;
  assert.equal(app.myParticipant().pid, "own");
  assert.equal(tabs.getData(app).tabsWatch.canLeave, true);
  assert.equal(await watch("other"), true);
  assert.equal(app.myParticipant().followPid, "other");
  delete world.netArchs.a;
  assert.equal(app.myParticipant().pid, "own");
});

await test("legacy watcher validity requires an active player", () => {
  reset();
  world.session.participants["user:p"] = { kind: "spectator", userId: "p", archId: "a" };
  assert.equal(app.myParticipant().kind, "spectator");
  world.session.participants.ally.jackedIn = false;
  assert.equal(app.myParticipant(), null);
});

await test("legacy empty-arch leave keeps own runner", async () => {
  reset();
  world.session.participants.own = runner("p", "b");
  await watch();
  assert.equal(await act("session.spectate", { userId: "p", archId: "" }), true);
  assert.equal(app.myParticipant().pid, "own");
  assert.equal(mySpectators().length, 0);
});

await test("watch toggle is local and successful follow clears selection", async () => {
  reset();
  const handlers = new Map();
  tabs.activateListeners(app, { find: (selector) => ({ on: (event, fn) => handlers.set(selector, fn) }) });
  handlers.get('[data-action="watch-toggle"]')();
  assert.equal(app.state.watchOpen, true);
  assert.equal(mySpectators().length, 0);
  app.state.selection = "runner:old";
  await handlers.get('[data-action="spectate-switch"]')({ currentTarget: { dataset: { archId: "a", followPid: "ally" } } });
  assert.equal(app.state.watchOpen, false);
  assert.equal(app.state.selection, "");
  assert.equal(app.myParticipant().followPid, "ally");
});

await test("leave listener rejects runner pid, removes spectator only", async () => {
  reset();
  world.session.participants.own = runner("p", "b");
  await watch();
  const handlers = new Map();
  tabs.activateListeners(app, { find: (selector) => ({ on: (event, fn) => handlers.set(selector, fn) }) });
  const leave = handlers.get('[data-action="spectate-leave"]');
  await leave({ currentTarget: { dataset: { pid: "own" } } });
  assert.equal(app.myParticipant().kind, "spectator");
  await leave({ currentTarget: { dataset: { pid: app.myParticipant().pid } } });
  assert.equal(app.myParticipant().pid, "own");
});

console.log(`PASS ${passed} focused spectator scenarios, including 8 role/permission combinations.`);
