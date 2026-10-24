/* Actual view-model regressions, without a running Foundry: node tools/canvas-test.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const users = new Map([["gm", { id: "gm", isGM: true }], ["p", { id: "p", isGM: false }], ["s", { id: "s", isGM: false }]]);
users.find = (fn) => [...users.values()].find(fn);
const actors = new Map([["d", { name: "Imp", img: "imp.png", system: { stats: { rez: { value: 15, max: 15 } } } }]]);
const floors = [
  { id: "a", parentId: "" }, { id: "b", parentId: "a" },
  { id: "c", parentId: "b", demon: { id: "d", type: "imp", actorId: "d" } },
  { id: "x", parentId: "b", ice: [{ id: "hidden", type: "hellhound" }] },
  { id: "z", parentId: "c" },
].map((f) => ({ kind: "custom", ...f }));
const arch = { id: "arch", floors };
const part = { kind: "runner", userId: "p", archId: "arch", floorIndex: 2, visitedFloorIds: ["a", "b", "c"] };
const session = { activeTab: "arch", participants: { p: part, s: { kind: "spectator", userId: "s", archId: "arch" } } };
const game = { user: users.get("p"), users, actors, i18n: { localize: (k) => k, format: (k) => k } };
const ctx = vm.createContext({ game, fromUuidSync: uuid => actors.get(uuid), console });
function load(path, imports = {}) {
  const source = readFileSync(new URL(path, root), "utf8");
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
  const body = source.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "");
  return vm.runInContext(`(function(imports){const {${Object.keys(imports)}}=imports;${body};return {${names}};})`, ctx, { filename: path })(imports);
}
const constants = load("scripts/constants.js");
const graph = load("scripts/topology.js");
const mechanics = load("scripts/data.js", { ...constants, ...graph });
const descriptions = load("scripts/descriptions.js", constants);
const catalog = load("scripts/reference-catalog.js");
const equipment = load("scripts/equipment.js", catalog);
const icons = load("scripts/program-icons.js", constants);
const rules = load("scripts/rules-reference.js");
const targetCalls = [];
const deps = { ...constants, ...graph, ...mechanics, ...descriptions, ...catalog, ...equipment, ...icons, ...rules, mount3D: () => {}, dispose3D: () => {}, getWorld: (k) => k === "session" ? session : { arch },
  mutate: (op, payload) => targetCalls.push({ op, payload }), isPlayerRunner: (p) => p.kind === "runner" && p.userId === "p",
  getDeck: actor => actor?.deck || null, installedPrograms: deck => deck?.programs || [], userNetrunnerActor: () => null };
const canvas = load("scripts/apps/arch-canvas.js", deps);
const help = load("scripts/apps/help.js", deps);
const app = { state: {}, myParticipant: () => ({ pid: game.user.id, ...session.participants[game.user.id] }) };
let count = 0;
function test(name, fn) { fn(); console.log(`OK ${name}`); count++; }
const view = () => canvas.getData(app).canvas;
test("player branch fog never reveals sibling content", () => {
  assert.deepEqual(Array.from(view().floors, (f) => f.floorId), ["a", "b", "c"]);
  assert.equal(view().floors.some((f) => f.entities.some((e) => e.name === "hellhound")), false);
});
test("frontier has one stub per branch, only adjacent stub is traversable", () => {
  const fog = view().fogNodes;
  assert.equal(fog.length, 2);
  assert.equal(fog.find((f) => f.floorId === "x").showMoveHere, false);
  assert.equal(fog.find((f) => f.floorId === "z").showMoveHere, true);
});
test("fork offers each hidden child separately", () => {
  part.floorIndex = 1; part.visitedFloorIds = ["a", "b"];
  assert.deepEqual(Array.from(view().fogNodes, (f) => f.showMoveHere), [true, true]);
  part.floorIndex = 2; part.visitedFloorIds = ["a", "b", "c"];
});
test("demon has its own floor section, target metadata retained", () => {
  const f = view().floors.find((f) => f.floorId === "c");
  assert.equal(f.entities.length, 0);
  assert.equal(f.demonEntities[0].ref, "demon:arch:c:d");
  assert.equal(f.demonEntities[0].isDemon, true);
  assert.equal(f.demonEntities[0].rez, 15);
});
test("spectator sees exactly the player's branch visibility", () => {
  game.user = users.get("s");
  assert.deepEqual(Array.from(view().floors, (f) => f.floorId), ["a", "b", "c"]);
  assert.equal(view().fogNodes.some((f) => f.showMoveHere), false);
});
test("GM sees full tree and unique deepest bottom", () => {
  game.user = users.get("gm");
  assert.equal(view().floors.length, 5);
  assert.equal(view().floors.find((f) => f.isRoot).floorId, "z");
  assert.equal(view().fogNodes.length, 0);
});
test("reference highlight uses same branch fog", () => {
  game.user = users.get("p");
  assert.equal(help.getData(app).help.iceAntiNetrunner.find((e) => e.key === "hellhound").framed, false);
  session.reveal = { p: { arch: ["x"] } };
  assert.equal(help.getData(app).help.iceAntiNetrunner.find((e) => e.key === "hellhound").framed, true);
});
test("watching a named ally uses only that runner's view", () => {
  game.user = users.get("s");
  session.participants.s.followPid = "p";
  session.reveal = {};
  assert.deepEqual(Array.from(view().floors, (f) => f.floorId), ["a", "b", "c"]);
  session.participants.s.followPid = "missing";
  assert.equal(view().floors.length, 0);
  delete session.participants.s.followPid;
});
test("editing gaps into history positions every known component", () => {
  game.user = users.get("p");
  arch.floors = [
    { id: "a", parentId: "" }, { id: "b", parentId: "a" },
    { id: "h1", parentId: "b" }, { id: "h2", parentId: "h1" },
    { id: "c", parentId: "h2" }, { id: "z", parentId: "c" },
    { id: "x", parentId: "b" },
  ];
  part.floorIndex = 1; part.visitedFloorIds = ["a", "b", "c", "z"];
  const result = view();
  assert.ok(result.nodes.every((f) => Number.isInteger(f.row) && Number.isInteger(f.column)));
  assert.ok(result.nodes.findIndex((f) => f.floorId === "h1") < result.nodes.findIndex((f) => f.floorId === "c"));
  arch.floors = floors;
});
test("legacy linear visited/reveal remain visible", () => {
  arch.floors = floors.map(({ parentId, ...f }) => f);
  part.floorIndex = 1; part.maxFloor = 2; part.visitedFloorIds = [];
  session.reveal = { p: { arch: 3 } };
  assert.equal(view().floors.length, 4);
  assert.equal(view().branched, false);
  assert.equal(view().fogNodes[0].floorId, "z");
});
test("explicit reordered linear tree displays from entry to bottom", () => {
  arch.floors = [
    { id: "last", parentId: "middle" }, { id: "entry", parentId: "" },
    { id: "middle", parentId: "entry" },
  ];
  game.user = users.get("gm");
  assert.deepEqual(Array.from(view().floors, (f) => f.floorId), ["entry", "middle", "last"]);
  assert.equal(view().floors.at(-1).isRoot, true);
});
test("rerender clears removed or hidden hover without changing program selection", () => {
  arch.floors = floors; game.user = users.get("p"); session.reveal = {};
  part.floorIndex = 2; part.visitedFloorIds = ["a", "b", "c"];
  app.state.selection = "prog:p:off-floor"; app.hovered = "demon:arch:c:d";
  view(); assert.equal(app.hovered, "demon:arch:c:d", "valid hover survives redraw");
  const demon = floors[2].demon; floors[2].demon = null;
  view(); assert.equal(app.hovered, "", "removed entity hover clears without mouseleave");
  floors[2].demon = demon; app.hovered = "demon:arch:c:d";
  part.floorIndex = 0; part.visitedFloorIds = ["a"];
  view(); assert.equal(app.hovered, "", "fogged entity hover clears");
  assert.equal(app.state.selection, "prog:p:off-floor", "off-floor program selection is untouched");
});
test("target callbacks validate current visible VM, including program minis", () => {
  game.user = users.get("p"); part.floorIndex = 2; part.visitedFloorIds = ["a", "b", "c"]; view();
  canvas.activateListeners(app, { find: () => [] });
  const before = targetCalls.length;
  app.onTarget("demon:arch:c:d"); assert.equal(targetCalls.length, before + 1);
  app.onTarget("ice:arch:x:hidden"); app.onTarget(""); assert.equal(targetCalls.length, before + 1, "hidden and empty refs do not mutate targets");
  app._canvasVM.nodes.push({ participants: [{ ref: "runner:fixture", progMinis: [{ ref: "prog:fixture:custom" }] }] });
  app.hovered = "prog:fixture:custom"; app.onTarget(app.hovered); assert.equal(targetCalls.length, before + 2);
  view(); assert.equal(app.hovered, "", "removed mini hover clears");
  app.onTarget("prog:fixture:custom"); assert.equal(targetCalls.length, before + 2, "old callbacks validate the refreshed VM");
  part.floorIndex = 0; part.visitedFloorIds = ["a"]; view();
  app.onTarget("demon:arch:c:d"); assert.equal(targetCalls.length, before + 2, "new fog blocks an existing target callback");
});
test("empty architecture clears hover and rejects stale target callback", () => {
  game.user = users.get("gm"); const previousTab = session.activeTab;
  session.activeTab = "missing"; app.hovered = "demon:arch:c:d";
  assert.equal(view().empty, true); assert.equal(app._canvasVM, null); assert.equal(app.hovered, "");
  const before = targetCalls.length; app.onTarget("demon:arch:c:d"); assert.equal(targetCalls.length, before);
  assert.equal(app.state.selection, "prog:p:off-floor"); session.activeTab = previousTab;
});
const armor = id => ({ id, name: "Armor", system: { class: "defender", isRezzed: true, rez: { value: 7, max: 7 } } });
const runner = { id: "r", uuid: "Actor.r", name: "Netrunner", deck: { programs: [armor("used"), armor("unused"), { id: "bi", name: "Hellhound", system: { class: "blackice", isRezzed: true, rez: { value: 20, max: 20 } } }] } };
const ice = { id: "owned", uuid: "Actor.owned", name: "Owned ICE", system: { stats: { rez: { value: 20, max: 20 } } } };
actors.set(runner.uuid, runner); actors.set(ice.id, ice);
Object.assign(actors.get("d"), { id: "d", uuid: "Actor.d" });
test("current runner, deployed program and demon highlight their exact initiative actor", () => {
  arch.floors = floors; game.user = users.get("p"); part.actorUuid = runner.uuid;
  part.floorIndex = 2; part.visitedFloorIds = ["a", "b", "c"];
  session.progState = { "p|bi": { actorId: ice.id, mode: "deployed", floorIndex: 2 } };
  game.combat = { id: "combat", started: true, round: 1, turn: 0, combatant: { id: "runner", actorId: runner.id, actor: runner } };
  let result = view(), floor = result.floors.find(f => f.floorId === "c");
  assert.equal(floor.participants[0].isCurrentTurn, true); assert.equal(result.currentTurnName, runner.name);
  assert.equal(floor.entities.find(e => e.ref === "prog:p:bi").isCurrentTurn, false);
  game.combat.combatant = { id: "ice", actorId: ice.id, actor: ice };
  result = view(); floor = result.floors.find(f => f.floorId === "c");
  assert.equal(floor.participants[0].isCurrentTurn, false);
  assert.equal(floor.entities.find(e => e.ref === "prog:p:bi").isCurrentTurn, true); assert.equal(result.currentTurnName, ice.name);
  game.combat.combatant = { id: "demon", actorId: "d", actor: actors.get("d") };
  result = view(); assert.equal(result.floors.find(f => f.floorId === "c").demonEntities[0].isCurrentTurn, true);
  assert.equal(result.currentTurnName, "Imp");
  game.combat.started = false; assert.equal(view().currentTurnName, "");
});
test("used badges follow individual program round allowances and clear next round", () => {
  game.combat.started = true;
  session.programUsage = { [runner.uuid]: { round: "combat:1", ids: { used: true, bi: true } } };
  let floor = view().floors.find(f => f.floorId === "c");
  assert.equal(floor.participants[0].progMinis.find(p => p.ref === "prog:p:used").used, true);
  assert.equal(floor.participants[0].progMinis.find(p => p.ref === "prog:p:unused").used, false);
  assert.equal(floor.entities.find(p => p.ref === "prog:p:bi").used, true);
  game.combat.round = 2; floor = view().floors.find(f => f.floorId === "c");
  assert.equal(floor.entities.find(p => p.ref === "prog:p:bi").used, false);
  assert.equal(floor.participants[0].progMinis.find(p => p.ref === "prog:p:used").used, false);
});
test("turn name and highlight never reveal the actor behind branch fog to player or spectator", () => {
  const hidden = { id: "secret", uuid: "Actor.secret", name: "Secret ICE" }; actors.set(hidden.id, hidden);
  floors[3].ice[0].actorId = hidden.id; game.combat.combatant = { id: "secretTurn", actorId: hidden.id, actor: hidden };
  for (const id of ["p", "s"]) { game.user = users.get(id); assert.equal(view().currentTurnName, ""); }
  game.user = users.get("gm"); assert.equal(view().currentTurnName, hidden.name);
  game.combat.combatant = { id: "meatTurn", actorId: "outside", actor: { id: "outside", uuid: "Actor.outside" } };
  assert.equal(view().currentTurnName, "", "a combatant outside this architecture has no NET indicator");
});
console.log(`${count} canvas/reference checks passed.`);
