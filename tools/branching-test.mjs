/* Zero-dependency regressions: node tools/branching-test.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const clone = (value) => JSON.parse(JSON.stringify(value));
const settings = new Map();
const calls = [];
const warnings = [];
let serial = 0;
const users = new Map([["gm", { id: "gm", isGM: true }], ["player", { id: "player", isGM: false }], ["other", { id: "other", isGM: false }]]);
users.filter = (fn) => [...users.values()].filter(fn);
const game = {
  user: users.get("gm"), users, actors: new Map(),
  settings: { get: (_, key) => settings.get(key), set: async (_, key, value) => { settings.set(key, clone(value)); return value; } },
  i18n: { localize: (key) => key, format: (key) => key },
};
const context = vm.createContext({
  console, game, fromUuidSync: () => null,
  foundry: { utils: { deepClone: clone, randomID: () => String(++serial) } },
  ui: { notifications: { warn: (key) => warnings.push(key) } },
  ChatMessage: { create: async () => ({}) },
});

// Execute the actual module bodies, replacing only Foundry/system imports.
function load(relative, imports = {}, privateExports = []) {
  const path = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const source = readFileSync(path, "utf8");
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
  names.push(...privateExports);
  const body = source.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "");
  return vm.runInContext(`(function(imports) { const {${Object.keys(imports).join(",")}} = imports;\n${body}\nreturn {${names.join(",")}}; })`, context, { filename: path })(imports);
}
const constants = load("scripts/constants.js");
const graphFns = load("scripts/topology.js");
const { topology, visibleFloorIds, pathfinderFloors } = graphFns;
const bridge = Object.fromEntries(["createIceActor", "createDemonActor", "duplicateEntityActor", "deleteEntityActors", "renameEntityFolder", "applyActorOverrides"].map((name) => [name, async (...args) => { calls.push([name, ...args]); return `actor_${++serial}`; }]));
bridge.getDeck = () => null;
const data = load("scripts/data.js", { ...constants, ...graphFns, bridge });
const editor = load("scripts/apps/editor.js", { ...constants, ...graphFns, ...data });
const actions = load("scripts/apps/actions.js", { ...constants, ...graphFns, ...data, bridge, equipmentProfile: () => ({ slideAttempts: 1 }) }, ["abilityAvailability"]);
const eq = (actual, expected) => assert.deepEqual(clone(actual), expected);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`OK ${name}`); }
const floor = (id, parentId, extra = {}) => ({ id, ...(parentId === undefined ? {} : { parentId }), kind: "custom", ice: [], demon: null, ...extra });
const arch = (floors) => ({ id: "a", name: "Test", floors });
const linear = () => arch([floor("e"), floor("j"), floor("b"), floor("c")]);
const branch = () => arch([floor("e", ""), floor("j", "e"), floor("l", "j"), floor("r", "j"), floor("b", "l")]);
const runner = (index = 0, extra = {}) => ({ kind: "runner", userId: "player", actorUuid: "", archId: "a", floorIndex: index, ...extra });
function reset(a = branch(), part = runner()) {
  settings.set("netArchs", { a: clone(a) });
  settings.set("netTree", []);
  settings.set("session", { tabs: ["a"], participants: { p: clone(part) } });
  calls.length = warnings.length = 0;
}
const op = (name, payload, user = "gm") => data.applyOp(name, payload, user);
const session = () => settings.get("session");
const visible = (s, a) => [...visibleFloorIds(s, "p", a)].sort();

await test("legacy and single-floor topology use null entry and deepest root", () => {
  const g = topology(linear());
  eq(g, { parents: [null, 0, 1, 2], children: [[1], [2], [3], []], depths: [0, 1, 2, 3], rootIndex: 3, branched: false, error: null });
  assert.equal(topology(arch([floor("e")])).rootIndex, 0);
});
await test("branch at depth 1, forward references, and unrestricted branch count", () => {
  const a = branch();
  eq(topology(a).parents, [null, 0, 1, 1, 2]);
  assert.equal(topology(a).rootIndex, 4);
  a.floors.reverse();
  assert.equal(topology(a).error, null);
  assert.equal(topology(a).rootIndex, 0);
  eq(topology(a).parents, [2, 3, 3, 4, null]);
  for (let i = 0; i < 100; i++) a.floors.push(floor(`side${i}`, "j"));
  assert.equal(topology(a).error, null);
});
await test("reject malformed, disconnected, cyclic, duplicate, early and tied graphs", () => {
  for (const floors of [[], [floor("e", "missing")], [floor("e", "e")], [floor("e", ""), floor("x", "")], [floor("e", ""), floor("x", "y"), floor("y", "x")], [floor("e"), floor("e")], [floor("e", null)]]) {
    assert.equal(topology(arch(floors)).error, "CRNS.Errors.InvalidTopology");
  }
  assert.equal(topology(arch([floor("e", ""), floor("l", "e"), floor("r", "e")])).error, "CRNS.Errors.EarlyBranch");
  assert.equal(topology(arch(branch().floors.slice(0, 4))).error, "CRNS.Errors.AmbiguousRoot");
});
await test("fog preserves legacy max/reveal and exact branch history without sibling leaks", () => {
  const s = { participants: { p: runner(1, { maxFloor: 2 }) }, reveal: { p: { a: 3 } } };
  eq(visible(s, linear()), ["b", "c", "e", "j"]);
  s.participants.p = runner(2, { maxFloor: 99 });
  eq(visible(s, branch()), ["e", "j", "l"]);
  s.participants.p.visitedFloorIds = ["e", "r", "removed"];
  s.reveal.p.a = ["b", "removed"];
  eq(visible(s, branch()), ["b", "e", "j", "l", "r"]);
  s.participants.p.archId = "other";
  eq(visible(s, branch()), []);
});
await test("Pathfinder walks path-distance and stops only a blocked subtree", () => {
  const a = branch();
  a.floors.push(floor("r2", "r"), floor("bottom", "b"));
  eq(pathfinderFloors(a, 1, 1, () => false), ["j", "l", "r"]);
  eq(pathfinderFloors(a, 1, 5, (f) => f.id === "l"), ["j", "l", "r", "r2"]);
  eq(pathfinderFloors(a, 1, 5, (f) => f.id === "j"), ["j"]);
  eq(pathfinderFloors(a, 2, 5, () => false), ["l", "b", "bottom"]);
  eq(pathfinderFloors(a, 1, 0, () => false), ["j"]);
  eq(pathfinderFloors(linear(), 1, 2, () => false), ["j", "b", "c"]);
});
await test("actual move operations enforce owner adjacency, no skips/sibling teleport", async () => {
  reset();
  assert.equal(await op("session.move", { pid: "p", floorIndex: 1 }, "other"), false);
  eq(await op("session.move", { pid: "p", floorIndex: 2 }, "player"), { error: "CRNS.Errors.MoveStep" });
  assert.equal(await op("session.move", { pid: "p", floorIndex: 1 }, "player"), true);
  assert.equal(await op("session.move", { pid: "p", floorIndex: 2 }, "player"), true);
  eq(await op("session.move", { pid: "p", floorIndex: 3 }, "player"), { error: "CRNS.Errors.MoveStep" });
  assert.equal(await op("session.move", { pid: "p", floorIndex: 1 }, "player"), true);
  eq(session().participants.p.visitedFloorIds, ["e", "j", "l"]);
  eq(visible(session(), branch()), ["e", "j", "l"]);
  assert.equal(await op("session.move", { pid: "p", floorIndex: 4 }), true);
  eq(await op("session.move", { pid: "p", floorIndex: 1.5 }, "player"), { error: "CRNS.Errors.MoveStep" });
});
await test("password blocks child steps only, even with reversed display order", async () => {
  const a = branch();
  a.floors[2].kind = "password";
  a.floors.reverse();
  reset(a, runner(2));
  eq(await op("session.move", { pid: "p", floorIndex: 0 }, "player"), { error: "CRNS.Errors.PasswordBlocked" });
  assert.equal(await op("session.move", { pid: "p", floorIndex: 3 }, "player"), true);
  assert.equal(await op("session.move", { pid: "p", floorIndex: 2 }, "player"), true);
  session().floorState = { "a:l": { breached: true } };
  assert.equal(await op("session.move", { pid: "p", floorIndex: 0 }, "player"), true);
});
await test("legacy migration alone derives visited range", async () => {
  reset(linear(), runner(2, { maxFloor: 3 }));
  await op("session.move", { pid: "p", floorIndex: 1 }, "player");
  eq(session().participants.p.visitedFloorIds, ["e", "j", "b", "c"]);
  reset(branch(), runner(2, { maxFloor: 4 }));
  await op("session.move", { pid: "p", floorIndex: 1 }, "player");
  eq(session().participants.p.visitedFloorIds, ["l", "j"]);
});
await test("connect uses actual entry and resets visited/revealed history", async () => {
  const a = branch(); a.floors.reverse();
  reset(a);
  session().reveal = { p: { a: ["b"] } };
  assert.equal(await op("session.connect", { pid: "p", archId: "a", userId: "player" }), true);
  assert.equal(session().participants.p.floorIndex, 4);
  eq(session().participants.p.visitedFloorIds, ["e"]);
  assert.equal(session().reveal.p, undefined);
  await op("session.disconnect", { pid: "p" });
  eq(session().participants.p.visitedFloorIds, []);
});
await test("actual Pathfinder keeps DV > total comparator and branch-ID reveal", async () => {
  const a = branch();
  a.floors.push(floor("r2", "r"), floor("bottom", "b"));
  Object.assign(a.floors[2], { kind: "password", dv: 4 });
  reset(a, runner(1));
  await op("run.abilityResult", { pid: "p", ability: "pathfinder", total: 3 }, "player");
  eq(session().reveal.p.a, ["j", "l", "r", "r2"]);
  await op("run.abilityResult", { pid: "p", ability: "pathfinder", total: 4 }, "player");
  assert.ok(session().reveal.p.a.includes("bottom"));
  reset(linear(), runner(1));
  await op("run.abilityResult", { pid: "p", ability: "pathfinder", total: 2 }, "player");
  assert.equal(session().reveal.p.a, 3);
  a.floors[1] = floor("j", "e", { kind: "password", dv: 5 });
  reset(a, runner(1));
  await op("run.abilityResult", { pid: "p", ability: "pathfinder", total: 3 }, "player");
  eq(session().reveal.p.a, ["j"]);
  session().floorState = { "a:j": { breached: true }, "a:l": { breached: true } };
  await op("run.abilityResult", { pid: "p", ability: "pathfinder", total: 3 }, "player");
  assert.ok(session().reveal.p.a.includes("bottom"));
});
await test("actual Virus uses unique deepest leaf, not last array element", async () => {
  const a = branch(); a.floors.reverse();
  reset(a, runner(0));
  session().participants.p.virusWork = { dv: 10, actions: 2, spent: 2, archId: "a", floorId: "b" };
  eq(await op("run.abilityResult", { pid: "p", ability: "virus", total: 11 }, "player"), { ok: true, applied: true });
  session().participants.p.floorIndex = 4;
  eq(await op("run.abilityResult", { pid: "p", ability: "virus", total: 11 }, "player"), { ok: false, applied: false, error: "CRNS.Rules.VirusConfigure" });
  assert.equal(actions.abilityAvailability(runner(0), session(), { a }).virus, true);
  assert.equal(actions.abilityAvailability(runner(4), session(), { a }).virus, false);
});
await test("update preserves runner/program identities and prunes removed fog IDs", async () => {
  const a = branch();
  reset(a, runner(4, { visitedFloorIds: ["e", "l", "b", "removed"] }));
  session().reveal = { p: { a: ["b", "removed"] } };
  session().progState = { "p|prog": { mode: "trap", floorIndex: 4 } };
  session().progFloors = { "p|prog": 3 };
  a.floors.reverse();
  assert.equal(await op("arch.update", { archId: "a", arch: a }), true);
  assert.equal(session().participants.p.floorIndex, 0);
  assert.equal(session().progState["p|prog"].floorIndex, 0);
  assert.equal(session().progFloors["p|prog"], 1);
  eq(session().reveal.p.a, ["b"]);
  assert.ok(!session().participants.p.visitedFloorIds.includes("removed"));
  a.floors = a.floors.filter((f) => f.id !== "b");
  a.floors.push(floor("newbottom", "l"));
  assert.equal(await op("arch.update", { archId: "a", arch: a }), true);
  assert.equal(a.floors[session().participants.p.floorIndex].id, "l");
  eq(session().reveal.p.a, []);
});
await test("linear-to-tree update migrates old fog by identity before reordering", async () => {
  const a = linear();
  reset(a, runner(2, { maxFloor: 2 }));
  session().reveal = { p: { a: 3 } };
  a.floors.forEach((f, i) => { f.parentId = i ? a.floors[i - 1].id : ""; });
  a.floors.reverse();
  await op("arch.update", { archId: "a", arch: a });
  assert.equal(session().participants.p.floorIndex, 1);
  eq(session().participants.p.visitedFloorIds, ["e", "j", "b"]);
  eq(session().reveal.p.a, ["e", "j", "b", "c"]);
});
await test("invalid save/import/duplicate cause no actor side effects", async () => {
  const a = branch(); a.floors.pop(); a.floors[0].ice = [{ id: "ice", type: "asp" }];
  reset(a);
  for (const name of ["arch.update", "arch.import", "arch.duplicate"]) {
    eq(await op(name, { archId: "a", arch: a }), { error: "CRNS.Errors.AmbiguousRoot" });
    eq(calls, []);
  }
  a.floors.push(floor("j", "e"));
  eq(await op("arch.import", { arch: a }), { error: "CRNS.Errors.InvalidTopology" });
  eq(calls, []);
});
await test("copy/import remap parent IDs including forward references and actor snapshots", async () => {
  const a = branch(); a.floors.reverse();
  a.floors[0].ice = [{ id: "oldice", type: "asp", actorId: "sourceActor", actorData: { name: "Snapshot" } }];
  reset(a);
  for (const name of ["arch.duplicate", "arch.import"]) {
    const result = await op(name, { archId: "a", arch: a });
    const copied = settings.get("netArchs")[result.archId];
    eq(topology(copied).parents, clone(topology(a).parents));
    assert.equal(topology(copied).error, null);
    assert.ok(copied.floors.every((f) => !a.floors.some((old) => old.id === f.id)));
    assert.ok(copied.floors[0].ice[0].actorId);
  }
  assert.ok(calls.some(([name]) => name === "applyActorOverrides"));
  const legacyCopy = await op("arch.import", { arch: linear() });
  assert.ok(settings.get("netArchs")[legacyCopy.archId].floors.every((f) => !Object.hasOwn(f, "parentId")));
});
await test("import checks caps before creating actors and keeps one-floor legacy archives", async () => {
  const a = linear();
  a.floors[0].demon = { type: "imp" };
  a.floors[1].demon = { type: "imp" };
  reset();
  eq(await op("arch.import", { arch: a }), { error: "CRNS.Errors.TooManyDemons" });
  eq(calls, []);
  const result = await op("arch.import", { arch: arch([floor("single")]) });
  assert.equal(topology(settings.get("netArchs")[result.archId]).rootIndex, 0);
});

function editorHarness(a) {
  reset(a);
  const app = { state: { editorArchId: "a", draft: clone(a) }, render: () => {} };
  const handlers = new Map();
  editor.activateListeners(app, { find: (selector) => selector === ".crns-editor-body" ? [{}] : { on: (event, fn) => handlers.set(`${selector}:${event}`, fn) } });
  return {
    app,
    fire: (action, id, value, event = "click") => handlers.get(`[data-action="${action}"]:${event}`)({ currentTarget: { value, closest: () => ({ dataset: { floorId: id } }) } }),
  };
}
await test("actual editor reorder freezes links and insert reconnects children", () => {
  const h = editorHarness(linear());
  h.fire("floor-down", "j");
  assert.equal(h.app.state.draft.floors.find((f) => f.id === "b").parentId, "j");
  assert.equal(topology(h.app.state.draft).error, null);
  h.fire("floor-insert", "j");
  const added = h.app.state.draft.floors.find((f) => !["e", "j", "b", "c"].includes(f.id));
  assert.equal(added.parentId, "j");
  assert.equal(h.app.state.draft.floors.find((f) => f.id === "b").parentId, added.id);
  const vm = editor.getData(h.app).editor;
  const junction = vm.floors.find((f) => f.id === "j");
  eq(junction.parentOptions.map((f) => f.id), ["e"]);
});
await test("actual editor branches, warns on tied save, reconnects delete and rejects early forks", async () => {
  const h = editorHarness(linear());
  h.fire("floor-branch", "e");
  assert.equal(h.app.state.draft.floors.length, 4);
  h.fire("floor-branch", "b");
  assert.equal(topology(h.app.state.draft).error, "CRNS.Errors.AmbiguousRoot");
  await h.fire("editor-save");
  assert.ok(warnings.includes("CRNS.Errors.AmbiguousRoot"));
  h.fire("floor-insert", "c");
  assert.equal(topology(h.app.state.draft).error, null);
  h.fire("floor-parent", "b", "e", "change");
  assert.equal(h.app.state.draft.floors.find((f) => f.id === "b").parentId, "j");
  h.fire("floor-delete", "j");
  assert.equal(h.app.state.draft.floors.find((f) => f.id === "b").parentId, "e");
  assert.equal(topology(h.app.state.draft).error, null);
  const b = editorHarness(branch());
  b.fire("floor-delete", "j");
  assert.equal(b.app.state.draft.floors.length, 5);
  assert.ok(warnings.includes("CRNS.Errors.EarlyBranch"));
});

console.log(`PASS ${passed} branching regressions (pure graph + actual operations/editor with Foundry mocks).`);
