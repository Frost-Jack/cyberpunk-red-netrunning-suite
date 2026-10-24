/* Actual module bodies with mocked Foundry I/O: node tools/security-test.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const clone = value => JSON.parse(JSON.stringify(value));
const world = {}, sent = [], deleted = [], cards = [], byUuid = new Map(), hooks = new Map(), derezzed = [];
const users = new Map(["a", "b", "player", "other"].map(id => [id, { id, active: true, isGM: ["a", "b"].includes(id) }]));
users.filter = fn => [...users.values()].filter(fn);
let sequence = 0, socketHandler, rollResolve, rollResult = { resultTotal: 10 };
const game = { user: users.get("a"), users, actors: new Map(), folders: [],
  settings: { get: (_, key) => world[key], set: async (_, key, value) => { world[key] = clone(value); return value; } },
  socket: { emit: (_, data) => sent.push(data), on: (_, fn) => { socketHandler = fn; } },
  i18n: { localize: key => key, format: key => key },
};
game.actors.some = fn => [...game.actors.values()].some(fn);
const context = vm.createContext({ console, game, setTimeout, clearTimeout,
  foundry: { utils: { deepClone: clone, randomID: () => `id${++sequence}`, debounce: fn => fn } },
  fromUuidSync: uuid => byUuid.get(uuid),
  Hooks: { on(key, fn) { if (!hooks.has(key)) hooks.set(key, []); hooks.get(key).push(fn); }, once() {}, callAll() {} },
  ui: { notifications: { warn() {}, error() {} } },
  Actor: { deleteDocuments: async ids => { deleted.push(...ids); for (const id of ids) game.actors.delete(id); },
    create: async input => { const actor = { ...clone(input), id: `created${++sequence}` }; game.actors.set(actor.id, actor); return actor; } },
  Folder: { create: async input => { const folder = { ...input, id: `folder${++sequence}` }; game.folders.push(folder); return folder; } },
  ChatMessage: { create: async data => { cards.push(data); }, getSpeaker: () => ({}) },
});
function load(relative, imports = {}, privates = []) {
  const url = new URL(`../${relative}`, import.meta.url), source = readFileSync(url, "utf8");
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]);
  const body = source.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "");
  return vm.runInContext(`(function(imports){const {${Object.keys(imports).join(",")}}=imports;\n${body}\nreturn {${[...names, ...privates].join(",")}};})`, context, { filename: url.pathname })(imports);
}
const constants = load("scripts/constants.js"), graph = load("scripts/topology.js");
const { netActionsMax: _netActionsMax, ...bridgeConstants } = constants;
const nativeBridge = load("scripts/cpr-bridge.js", { ...bridgeConstants, _netActionsMax });
const bridge = { ...nativeBridge, getDeck: () => null, installedPrograms: () => [],
  netActionsMax: () => 3, getInterfaceRank: () => 4, renameEntityFolder: async () => true,
  damageEntity: async () => true,
  derezProgram: async (owner, id) => { derezzed.push(id); owner.getOwnedItem(id).system.isRezzed = false; return true; },
  rollEntityStat: async () => rollResult === "pending" ? new Promise(resolve => { rollResolve = resolve; }) : rollResult,
};
const data = load("scripts/data.js", { ...constants, ...graph, bridge, netActionBonus: () => 0,
  onEquipmentJackOut: async () => {}, contentOperation: async () => ({ ok: true }),
});
const socket = load("scripts/socket.js", { ...constants, ...data });
const main = load("scripts/main.js", { ...constants, ...data, bridge }, ["handleSpeedTest", "handleSlideTest", "resolveReaction", "requestDefense", "handleDefenseResult", "handleDefenseRequest", "pruneDefenseRequests"]);
const op = (name, payload, id = "a") => data.applyOp(name, payload, id);
function reset() {
  for (const key of Object.keys(world)) delete world[key];
  Object.assign(world, clone(data.WORLD_OBJECTS));
  world.netArchs = { arch: { id: "arch", name: "Architecture", floors: [{ id: "entry", kind: "custom", ice: [], demon: null }] } };
  world.session.participants = { runner: { kind: "runner", userId: "player", actorUuid: "Actor.runner", archId: "arch", floorIndex: 0, jackedIn: true, actions: { value: 3, max: 3 } } };
  game.user = users.get("a"); game.actors.clear(); game.folders.length = 0;
  sent.length = deleted.length = cards.length = derezzed.length = 0; byUuid.clear(); rollResult = { resultTotal: 10 };
}
let passed = 0;
async function test(name, callback) { reset(); await callback(); passed++; console.log(`OK ${name}`); }
const eq = (a, b) => assert.deepEqual(clone(a), b);

await test("operation boundary rejects inherited names, unknown users and malformed payloads", async () => {
  for (const name of ["toString", "constructor", "__proto__", "missing"]) {
    assert.equal(data.hasOp(name), false); assert.equal(await op(name, {}), false);
  }
  for (const value of [null, [], "text", 3]) assert.equal(await op("run.spend", value), false);
  assert.equal(await op("run.spend", { pid: "runner" }, "missing"), false);
  assert.equal(world.session.participants.runner.actions.value, 3);
});
await test("serialized competing mutations preserve both action spends", async () => {
  eq(await Promise.all([op("run.spend", { pid: "runner" }, "player"), op("run.spend", { pid: "runner" }, "player")]), [true, true]);
  assert.equal(world.session.participants.runner.actions.value, 1);
});
await test("secondary GM relays to primary and accepts only its expected result", async () => {
  game.user = users.get("b");
  const result = data.mutate("run.spend", { pid: "runner" });
  assert.equal(world.session.participants.runner.actions.value, 3);
  assert.equal(sent[0].action, "mutate");
  data.resolveMutation(sent[0].requestId, "wrong", "b");
  data.resolveMutation(sent[0].requestId, "accepted", "a");
  assert.equal(await result, "accepted");
});
await test("socket duplicate request executes once; different requests both execute", async () => {
  socket.initSocket(); socket.initSocket();
  const request = { action: "mutate", op: "run.spend", payload: { pid: "runner" }, userId: "player", requestId: "dedup" };
  await Promise.all([socketHandler(request), socketHandler(clone(request))]);
  assert.equal(world.session.participants.runner.actions.value, 2);
  assert.equal(sent.length, 2); assert.equal(sent[0].gmId, "a");
  await socketHandler({ ...request, requestId: "different" });
  assert.equal(world.session.participants.runner.actions.value, 1);
  users.get("player").active = false;
  await socketHandler({ ...request, requestId: "inactive" });
  users.get("player").active = true;
  assert.equal(world.session.participants.runner.actions.value, 1);
});
await test("architecture edit keeps live program attachments and slide records", async () => {
  world.session.progState["runner|program"] = { actorId: "temporary", floorIndex: 0, mode: "trap" };
  world.session.attachments = [{ archId: "arch", progKey: "runner|program", pid: "runner" }, { archId: "arch", iceId: "removed", pid: "runner" }];
  world.session.slid = clone(world.session.attachments);
  assert.equal(await op("arch.update", { archId: "arch", arch: clone(world.netArchs.arch) }), true);
  eq(world.session.attachments, [{ archId: "arch", progKey: "runner|program", pid: "runner" }]);
  eq(world.session.slid, [{ archId: "arch", progKey: "runner|program", pid: "runner" }]);
});
await test("architecture edit cannot adopt a foreign actorId for later cleanup", async () => {
  game.actors.set("personal", { id: "personal", type: "blackIce" });
  const arch = clone(world.netArchs.arch);
  arch.floors[0].ice = [{ id: "entity", type: Object.keys(constants.BLACK_ICE)[0], actorId: "personal" }];
  assert.equal(await op("arch.update", { archId: "arch", arch }), true);
  const id = world.netArchs.arch.floors[0].ice[0].actorId;
  assert.notEqual(id, "personal"); assert.ok(game.actors.has("personal"));
  assert.equal(game.actors.get(id).flags[constants.MODULE_ID].managedEntity, true);
});
await test("jack-out clears pending tests, targets, deployment targets and activations", async () => {
  world.session.pendingTests = [{ id: "old", pid: "runner", ref: "ice:arch:entry:x" }];
  world.session.targets = { player: "runner:runner", other: "prog:runner:program" };
  world.session.progState["other|program"] = { targetRef: "runner:runner" };
  Object.assign(world.session.participants.runner, { slideAttempt: { targetRef: "ice:arch:entry:x" }, activations: { program: { id: "roll" } } });
  assert.equal(await op("run.jack", { pid: "runner", in: false }, "player"), true);
  eq(world.session.pendingTests, []); eq(world.session.targets, {});
  assert.equal(world.session.progState["other|program"].targetRef, "");
  assert.equal(world.session.participants.runner.slideAttempt, null);
  eq(world.session.participants.runner.activations, {});
});
await test("runner removal also prunes program floor overrides, reveal and targets", async () => {
  world.session.progFloors["runner|program"] = 0;
  world.session.reveal.runner = { arch: ["entry"] };
  world.session.targets.player = "runner:runner";
  assert.equal(await op("runner.remove", { pid: "runner" }), true);
  eq(world.session.progFloors, {}); eq(world.session.reveal, {}); eq(world.session.targets, {});
});
await test("spectator and runner in another architecture cannot apply entity damage", async () => {
  game.actors.set("ice", { id: "ice", name: "ICE", system: { stats: { rez: { value: 20 } } } });
  world.netArchs.arch.floors[0].ice = [{ id: "ice", actorId: "ice", type: "asp" }];
  world.session.targets.player = "ice:arch:entry:ice";
  for (const state of [{ kind: "spectator" }, { kind: "runner", archId: "elsewhere" }, { kind: "runner", archId: "arch", jackedIn: false }]) {
    Object.assign(world.session.participants.runner, state);
    assert.notEqual(await op("ent.damage", { actorId: "ice", amount: 1 }, "player"), true);
  }
  Object.assign(world.session.participants.runner, { kind: "runner", archId: "arch", jackedIn: true });
  assert.equal(await op("ent.damage", { actorId: "ice", amount: 1 }, "player"), true);
});
await test("cleanup deletes only explicitly managed ICE/demons, preserving legacy and personal actors", async () => {
  for (const [id, type, managed] of [["owned", "blackIce", true], ["legacy", "blackIce", false], ["personal", "character", true], ["demon", "demon", true]]) {
    game.actors.set(id, { id, type, flags: { [constants.MODULE_ID]: { managedEntity: managed } } });
  }
  assert.equal(await nativeBridge.deleteEntityActors(["owned", "owned", "legacy", "personal", "demon", "missing"]), true);
  eq(deleted, ["owned", "demon"]); assert.ok(game.actors.has("legacy")); assert.ok(game.actors.has("personal"));
});
await test("cleanup never removes an occupied architecture folder", async () => {
  let removed = 0;
  game.folders.push({ id: "root", type: "Actor", name: "NET Architectures", folder: null },
    { id: "child", type: "Actor", name: "Architecture", folder: { id: "root" }, flags: { [constants.MODULE_ID]: { managedEntityFolder: true } }, delete: async () => { removed++; } });
  game.actors.set("personal", { folder: { id: "child" } });
  assert.equal(await nativeBridge.deleteEntityFolder("Architecture"), true); assert.equal(removed, 0);
  game.actors.delete("personal");
  assert.equal(await nativeBridge.deleteEntityFolder("Architecture"), true); assert.equal(removed, 1);
  delete game.folders[1].flags;
  assert.equal(await nativeBridge.deleteEntityFolder("Architecture"), true); assert.equal(removed, 1);
});
await test("new ICE, program ICE and demon documents all carry managed marker", async () => {
  const ice = await nativeBridge.createIceActor(Object.keys(constants.BLACK_ICE)[0], "Architecture");
  const prog = await nativeBridge.createProgIceActor({ name: "Program", rez: 10 }, "Architecture");
  const demon = await nativeBridge.createDemonActor(Object.keys(constants.DEMONS)[0], "Architecture");
  for (const id of [ice, prog, demon]) assert.equal(game.actors.get(id).flags[constants.MODULE_ID].managedEntity, true);
});
function pendingTest() {
  game.actors.set("ice", { id: "ice", name: "ICE", system: { stats: { rez: { value: 20 } } } });
  world.netArchs.arch.floors[0].ice = [{ id: "ice", actorId: "ice", type: "asp" }];
  world.session.pendingTests = [{ id: "test", pid: "runner", iceActorId: "ice", ref: "ice:arch:entry:ice", targetRef: "runner:runner" }];
}
await test("cancelled GM SPEED roll leaves test pending and posts no result", async () => {
  pendingTest(); rollResult = null;
  await main.handleSpeedTest({ testId: "test", pid: "runner", runnerTotal: 20 });
  assert.equal(world.session.pendingTests.length, 1); assert.equal(cards.length, 0);
});
await test("SPEED result after jack-out is discarded", async () => {
  pendingTest(); rollResult = "pending";
  const result = main.handleSpeedTest({ testId: "test", pid: "runner", runnerTotal: 20 });
  await op("run.jack", { pid: "runner", in: false }, "player");
  rollResolve({ resultTotal: 10 }); await result;
  assert.equal(cards.length, 0); eq(world.session.pendingTests, []);
});
await test("in-flight duplicate reaction rolls once", async () => {
  let calls = 0, release;
  const callback = async () => { calls++; await new Promise(resolve => { release = resolve; }); };
  const first = main.resolveReaction("speed:test", callback);
  await main.resolveReaction("speed:test", callback);
  assert.equal(calls, 1); release(); await first;
});
function defense() {
  byUuid.set("Actor.runner", { name: "Runner", id: "runner" });
  main.requestDefense({ kind: "defenseRequest", pid: "runner", targetRef: "runner:runner", total: 14, attackerName: "ICE" });
  return sent.at(-1);
}
await test("defence result requires known request and consumes it once, ignoring forged attack metadata", async () => {
  const prompt = defense();
  await main.handleDefenseResult({ defenseId: "unknown", pid: "runner", defenseTotal: 20 });
  assert.equal(cards.length, 0);
  const reply = { defenseId: prompt.defenseId, pid: "runner", defenseTotal: 10, attackerTotal: 99, attackerName: "FORGED" };
  await main.handleDefenseResult(reply); await main.handleDefenseResult(reply);
  assert.equal(cards.length, 1); assert.ok(cards[0].content.includes("14")); assert.ok(!cards[0].content.includes("FORGED"));
});
await test("defence after target disconnect is discarded and local prompts disappear", async () => {
  const prompt = defense();
  context.CRNS = { ui: { _pendingDefense: [{ ...prompt, id: prompt.defenseId }] } };
  await op("session.disconnect", { pid: "runner" }, "player");
  main.pruneDefenseRequests();
  assert.equal(context.CRNS.ui._pendingDefense.length, 0);
  await main.handleDefenseResult({ defenseId: prompt.defenseId, pid: "runner", defenseTotal: 10 });
  assert.equal(cards.length, 0);
});
await test("duplicate defence delivery creates a single local prompt", async () => {
  const prompt = defense(); game.user = users.get("player");
  context.CRNS = { ui: { _pendingDefense: [], rendered: false } };
  main.handleDefenseRequest(prompt); main.handleDefenseRequest(prompt);
  assert.equal(context.CRNS.ui._pendingDefense.length, 1);
});
function managed(id) {
  const actor = { id, type: "blackIce", flags: { [constants.MODULE_ID]: { managedEntity: true } } };
  game.actors.set(id, actor); return actor;
}
function programState(programId = "removed", actorId = "temporary") {
  const key = `runner|${programId}`;
  world.session.progState[key] = { actorId, floorIndex: 0, mode: "trap" };
  world.session.progFloors[key] = 0;
  world.session.participants.runner.rezzed ||= {};
  world.session.participants.runner.rezzed[programId] = { rezzed: true };
  world.session.attachments.push({ archId: "arch", pid: "runner", progKey: key });
  world.session.pendingTests.push({ id: `test_${programId}`, pid: "runner", iceActorId: actorId, ref: `prog:runner:${programId}` });
  world.session.targets.other = `prog:runner:${programId}`;
  return key;
}
await test("document cleanup rejects existing documents and unauthorized callers", async () => {
  game.actors.set("runner", { id: "runner" });
  byUuid.set("Actor.runner", { getOwnedItem: () => ({ id: "existing" }) });
  const before = clone(world);
  assert.equal(await op("session.documentDeleted", { actorId: "runner" }), false);
  assert.equal(await op("session.documentDeleted", { actorUuid: "Actor.runner", programId: "existing" }), false);
  assert.equal(await op("session.documentDeleted", { actorId: "absent" }, "player"), false);
  eq(world, before); eq(deleted, []);
});
await test("manual runner Actor deletion removes roster and only managed backing documents", async () => {
  managed("temporary"); game.actors.set("personal", { id: "personal", type: "blackIce" });
  programState(); programState("other", "personal");
  world.session.reveal.runner = { arch: ["entry"] };
  world.session.programUsage["Actor.runner"] = { ids: { removed: true } };
  assert.equal(await op("session.documentDeleted", { actorId: "runner" }), true);
  eq(world.session.participants, {}); eq(world.session.progState, {}); eq(world.session.progFloors, {});
  eq(world.session.pendingTests, []); eq(world.session.attachments, []); eq(world.session.targets, {});
  eq(world.session.reveal, {}); eq(world.session.programUsage, {});
  eq(deleted, ["temporary"]); assert.ok(game.actors.has("personal"));
});
await test("manual architecture ICE or Demon deletion prunes exact defs and reaction refs", async () => {
  for (const kind of ["ice", "demon"]) {
    const floor = world.netArchs.arch.floors[0];
    const def = { id: "removed", actorId: "gone", type: kind === "ice" ? "asp" : "imp" };
    floor.ice = [{ id: "retained", actorId: "personal", type: "asp" }, ...(kind === "ice" ? [def] : [])];
    floor.demon = kind === "demon" ? def : null;
    world.session.targets.player = `${kind}:arch:entry:removed`;
    world.session.pendingTests = [{ id: "test", iceActorId: "gone", pid: "runner" }];
    world.session.attachments = [{ archId: "arch", iceId: "removed", pid: "runner" }];
    world.session.slid = clone(world.session.attachments);
    world.session.demonState.gone = { value: 2 };
    assert.equal(await op("session.documentDeleted", { actorId: "gone" }), true);
    eq(world.netArchs.arch.floors[0].ice, [{ id: "retained", actorId: "personal", type: "asp" }]);
    assert.equal(world.netArchs.arch.floors[0].demon, null);
    eq(world.session.pendingTests, []); eq(world.session.targets, {}); eq(world.session.demonState, {});
    if (kind === "ice") { eq(world.session.attachments, []); eq(world.session.slid, []); }
  }
});
await test("manual embedded Program deletion cleans only its mirror and managed backing actor", async () => {
  managed("temporary"); managed("keepActor");
  programState("keep", "keepActor"); programState();
  const kept = { id: "keep", type: "program", system: { isRezzed: true } };
  byUuid.set("Actor.runner", { getOwnedItem: id => id === "keep" ? kept : null });
  assert.equal(await op("session.documentDeleted", { actorUuid: "Actor.runner", programId: "removed" }), true);
  eq(Object.keys(world.session.progState), ["runner|keep"]);
  eq(Object.keys(world.session.participants.runner.rezzed), ["keep"]);
  assert.equal(world.session.pendingTests.length, 1); assert.equal(world.session.pendingTests[0].id, "test_keep");
  assert.ok(game.actors.has("keepActor")); assert.equal(kept.system.isRezzed, true);
  eq(deleted, ["temporary"]); eq(derezzed, []);
});
await test("manual backing Actor deletion derezzes its surviving Item and prevents phantom state", async () => {
  programState();
  const program = { id: "removed", type: "program", system: { isRezzed: true } };
  byUuid.set("Actor.runner", { getOwnedItem: id => id === "removed" ? program : null });
  world.session.programUsage["Actor.runner"] = { round: "manual:0", ids: { removed: true } };
  assert.equal(await op("session.documentDeleted", { actorId: "temporary" }), true);
  assert.equal(program.system.isRezzed, false); eq(derezzed, ["removed"]);
  eq(world.session.progState, {}); eq(world.session.participants.runner.rezzed, {});
  eq(world.session.pendingTests, []); eq(world.session.attachments, []); eq(world.session.targets, {});
  assert.equal(world.session.programUsage["Actor.runner"].ids.removed, true, "manual actor deletion cannot reset program allowance");
  assert.equal(await op("session.documentDeleted", { actorId: "temporary" }), true); eq(derezzed, ["removed"]);
});
await test("core document deletion hooks run cleanup only on the primary GM", async () => {
  const fire = (key, document) => { for (const fn of hooks.get(key) || []) fn(document); };
  for (const userId of ["player", "b"]) {
    game.user = users.get(userId); fire("deleteActor", { id: "runner" });
    await op("ping", {}); assert.ok(world.session.participants.runner);
  }
  game.user = users.get("a");
  programState(); managed("temporary");
  byUuid.set("Actor.runner", { getOwnedItem: () => null });
  fire("deleteItem", { id: "removed", type: "program", parent: { documentName: "Actor", uuid: "Actor.runner" } });
  await op("ping", {}); eq(world.session.progState, {}); eq(deleted, ["temporary"]);
  fire("deleteActor", { id: "runner", pack: "collection" }); await op("ping", {});
  assert.ok(world.session.participants.runner);
  fire("deleteActor", { id: "runner" }); await op("ping", {});
  eq(world.session.participants, {});
});
console.log(`${passed} security regression groups passed. This is mocked I/O, not a live Foundry session.`);
