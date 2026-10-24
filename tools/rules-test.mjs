/* Run: node tools/rules-test.mjs. Actual module bodies, mocked Foundry/CPR I/O. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const clone = value => JSON.parse(JSON.stringify(value));
const settings = new Map(), calls = [], cards = [], hooks = new Map();
const users = new Map([["gm", { id: "gm", isGM: true, active: true }], ["player", { id: "player", isGM: false }], ["other", { id: "other", isGM: false }]]);
users.filter = fn => [...users.values()].filter(fn);
let serial = 0, rollTotal = 10, allowRoll = true, slideLimit = 1, turnBonus = 0;
const game = { users, user: users.get("gm"), actors: new Map(), combat: null,
  settings: { get: (_, key) => settings.get(key), set: async (_, key, value) => { settings.set(key, clone(value)); return value; } },
  i18n: { localize: key => key, format: key => key }, socket: { emit: (...args) => calls.push(["socket", ...args]) }, system: { id: "cyberpunk-red-core" } };
const actorsByUuid = new Map();
class Roll {
  constructor(formula) { this.formula = formula; this.total = 10; }
  async evaluate() { return this; }
  async toMessage() {}
}
const context = vm.createContext({ console, game, Roll, setTimeout, clearTimeout, canvas: { scene: { id: "scene" } },
  fromUuidSync: uuid => actorsByUuid.get(uuid),
  foundry: { utils: { deepClone: clone, randomID: () => `id${++serial}`, debounce: fn => fn } },
  Hooks: { on: (key, fn) => hooks.set(key, fn), once: () => {}, callAll: (...args) => calls.push(["hook", ...args]) },
  ChatMessage: { create: async data => { cards.push(data); return data; }, getSpeaker: () => ({}) },
  ui: { notifications: { info: () => {}, warn: () => {}, error: () => {} } },
  Combat: { create: async () => (game.combat = combat()) },
});
function load(relative, imports = {}, privates = []) {
  const filename = new URL(`../${relative}`, import.meta.url);
  const source = readFileSync(filename, "utf8");
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]);
  const body = source.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "");
  return vm.runInContext(`(function(imports){const {${Object.keys(imports).join(",")}}=imports;\n${body}\nreturn {${[...names, ...privates].join(",")}};})`, context, { filename: filename.pathname })(imports);
}
function combat(started = true) {
  const combatants = [];
  combatants.contents = combatants;
  combatants.get = id => combatants.find(c => c.id === id);
  return { id: "combat", round: 1, turn: 0, started, combatants,
    async createEmbeddedDocuments(_, docs) { return docs.map(d => { const c = { ...d, id: `c${++serial}`, initiative: 10, setFlag: async (...args) => calls.push(["queueFlag", ...args]) }; combatants.push(c); return c; }); },
    async setInitiative(id, n) { combatants.find(c => c.id === id).initiative = n; calls.push(["initiative", n]); },
    async startCombat() { this.started = true; },
  };
}
function item(id, name = "Sword", cls = "antiprogramattacker", rez = 0) {
  const p = { id, name, type: "program", system: { class: cls, isRezzed: false, atk: 2, def: 3, rez: { value: rez, max: rez }, damage: { standard: "2d6", blackIce: "3d6" } },
    async update(changes) { for (const [key, value] of Object.entries(changes)) { const path = key.split("."); let at = this; while (path.length > 1) at = at[path.shift()]; at[path[0]] = value; } return this; } };
  return p;
}
function actor(id, programs = [], name = id, type = "character") {
  const deck = { id: `deck${id}`, system: { installedPrograms: programs }, createRoll: (...args) => { calls.push(["createRoll", ...args]); return new NativeRoll(); } };
  const a = { id, uuid: `Actor.${id}`, name, type, system: { roleInfo: { activeNetRole: "role" }, stats: { rez: { value: 20, max: 20 } } },
    itemTypes: { role: [{ id: "role", system: { rank: 10 } }] }, getEquippedCyberdeck: () => deck, getOwnedItem: id => programs.find(p => p.id === id),
    getFlag: () => true, createStatRoll: stat => { calls.push(["createStatRoll", stat]); return new NativeRoll(); },
    update: async changes => { for (const [key, value] of Object.entries(changes)) { const path = key.split("."); let at = a; while (path.length > 1) at = at[path.shift()]; at[path[0]] = value; } },
  };
  game.actors.set(id, a); actorsByUuid.set(a.uuid, a); return a;
}
class NativeRoll {
  constructor(name, value) { this.statName = name; this.statValue = value; calls.push(["nativeRoll", name, value]); }
  setNetCombat(name) { this.rollTitle = name; }
  async handleRollDialog(event, actor, item) { calls.push(["dialog", event, actor?.id, item?.id]); return allowRoll; }
  async roll() { this.resultTotal = rollTotal; calls.push(["roll"]); }
}
const constants = load("scripts/constants.js"), graph = load("scripts/topology.js");
const content = load("scripts/custom-content.js", constants);
const { netActionsMax: _netActionsMax, ...bridgeConstants } = constants;
const nativeBridge = load("scripts/cpr-bridge.js", { ...bridgeConstants, ...content, _netActionsMax, CPRRolls: { CPRProgramStatRoll: NativeRoll }, CPRChat: { RenderRollCard: async () => calls.push(["renderCard"]) }, CPRCONFIG: { interfaceAbilities: Object.fromEntries(["scanner", "backdoor", "cloak", "control", "eyedee", "pathfinder", "slide", "virus", "zap"].map(key => [key, key])) } });
const bridge = { ...nativeBridge,
  rezProgram: async (a, id) => { calls.push(["rez", a.id, id]); a.getOwnedItem(id).system.isRezzed = true; return true; },
  derezProgram: async (a, id) => { calls.push(["derez", a.id, id]); const p = a.getOwnedItem(id); p.system.isRezzed = false; p.system.rez.value = p.system.rez.max; return true; },
  setProgramDefeated: async (...args) => calls.push(["defeatedEffects", args[1], args[2]]),
  applyProgramDamage: async (a, id, n) => { const p = a.getOwnedItem(id); p.system.rez.value = Math.max(0, p.system.rez.value - n); return true; },
  damageEntity: async (id, n) => { const p = game.actors.get(id).system.stats.rez; p.value = Math.max(0, p.value - n); return true; },
  damageRunnerHp: async (...args) => { calls.push(["hpDamage", ...args]); return true; },
  deleteEntityActors: async ids => { calls.push(["deleteActors", ids]); for (const id of ids) game.actors.delete(id); return true; },
  createProgIceActor: async snap => { const a = actor(`ice${++serial}`, [], snap.name, "blackIce"); a.system.stats.rez = { value: snap.rez, max: snap.rezMax }; calls.push(["createIce", snap]); return a.id; },
};
let preventDestroy = false;
const runtime = {
  netActionBonus: () => turnBonus,
  onEquipmentJackIn: async (...args) => calls.push(["equipIn", args[1]]),
  onEquipmentJackOut: async (...args) => calls.push(["equipOut", args[1], args[4]]),
  onEquipmentTurn: async (...args) => calls.push(["equipTurn", args[1]]),
  beforeEquipmentDestroy: async (...args) => { calls.push(["beforeDestroy", args[1], args[2], args[5]]); return !preventDestroy; },
  afterEquipmentDestroy: async (...args) => calls.push(["afterDestroy", args[1]]),
  equipmentIceStats: (_s, _pid, _a, p) => ({ atk: p.system.atk }),
  equipmentBrainDamage: async (_s, _pid, _a, n, _b, options) => { calls.push(["brainHook", n, options]); return n; },
  queueArmor: (...args) => calls.push(["queueArmor", args[1], args[3]?.id]),
  equipmentAction: async (...args) => { calls.push(["equipmentAction", args[2], args[5]]); return { ok: true }; },
  equipmentProtection: () => false,
  equipmentProfile: () => ({ slideAttempts: slideLimit }), validateEquipmentLoadout: () => ({ valid: true }), equipmentDamageFormula: (_s, _r, _b, fallback) => fallback,
};
const data = load("scripts/data.js", { ...constants, ...graph, ...runtime, bridge });
const descriptions = load("scripts/descriptions.js", constants);
const actions = load("scripts/apps/actions.js", { ...constants, ...graph, ...data, ...descriptions, ...runtime, bridge }, ["programVMs", "stashDamage", "applyTargetDamage", "attackProgram", "wireBarResize", "buildRunnerVM", "buildEntityVM"]);
const main = load("scripts/main.js", { ...constants, ...data, bridge, eligibleNetrunner: bridge.eligibleNetrunner, initSocket: () => {}, NetrunningSuiteApp: class {} }, ["handleSpeedTest", "handleSlideTest", "postProgramAttackVisual", "handleRollRequest", "handleDefenseResult"]);
const state = () => settings.get("session");
const op = (name, payload = {}, user = "player") => data.applyOp(name, payload, user);
let runnerActor;
function reset(programs = []) {
  game.actors.clear(); actorsByUuid.clear(); game.combat = combat(); game.user = users.get("gm"); preventDestroy = false; allowRoll = true; rollTotal = 10;
  runnerActor = actor("r", programs);
  const enemy = actor("enemy", [], "Enemy");
  settings.set("netArchs", { a: { id: "a", name: "Architecture", floors: [
    { id: "entry", kind: "custom", ice: [] }, { id: "middle", kind: "custom", ice: [] }, { id: "bottom", kind: "custom", ice: [] },
  ] } });
  settings.set("session", { ...clone(data.WORLD_OBJECTS.session), activeTab: "a", participants: {
    p: { kind: "runner", pid: "p", userId: "player", actorUuid: runnerActor.uuid, archId: "a", jackedIn: true, floorIndex: 1, actions: { value: 20, max: 20 } },
    enemy: { kind: "runner", userId: "other", actorUuid: enemy.uuid, archId: "a", jackedIn: true, floorIndex: 1, actions: { value: 20, max: 20 } },
  }, targets: { player: "runner:enemy", gm: "runner:enemy" } });
  settings.set("autoRollNPC", true); calls.length = cards.length = 0; slideLimit = 1; turnBonus = 0;
}
const eq = (actual, expected) => assert.deepEqual(clone(actual), expected);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`OK ${name}`); }
const activate = (programId, extra = {}) => op("run.activateProgram", { pid: "p", programId, ...extra });

await test("#2 0 REZ retains Rezzed/native item and backing actor, no derez/reset", async () => {
  const p = item("b", "Worm", "booster", 7); p.system.isRezzed = true; reset([p]);
  await op("run.progDamage", { pid: "p", programId: "b", amount: 7 }, "gm");
  assert.equal(p.system.isRezzed, true); assert.equal(p.system.rez.value, 0);
  assert.equal(state().defeated["p|b"], true); assert.equal(state().destroyed["p|b"], undefined);
  assert.equal(calls.some(c => c[0] === "derez"), false);
  assert.equal((await activate("b")).error, "CRNS.Rules.DeactivateFirst");
  assert.equal(await op("run.deactivateProgram", { pid: "p", programId: "b" }), true);
  assert.equal((await activate("b")).ok, true); assert.equal(p.system.rez.value, 7);
});
await test("#2 destroy requires source effect; Dragon/Killer/Sabertooth and GM explicit work", async () => {
  for (const sourceName of ["Dragon", "Killer", "Sabertooth", "Banhammer"]) {
    const p = item("b", "Worm", "booster", 7); p.system.isRezzed = true; reset([p]);
    await op("run.progDamage", { pid: "p", programId: "b", amount: 7, sourceName }, "gm");
    assert.equal(!!state().destroyed["p|b"], sourceName !== "Banhammer");
    assert.equal(p.system.isRezzed, sourceName === "Banhammer");
  }
  const p = item("b", "Worm", "booster", 7); p.system.isRezzed = true; reset([p]);
  await op("run.progDamage", { pid: "p", programId: "b", amount: 9, effect: "destroy" }, "gm");
  assert.equal(state().destroyed["p|b"], true);
});
await test("#2 backing ICE defeat retained, explicit deactivation deletes it; GM restore works", async () => {
  const p = item("ice", "Hellhound", "blackice", 20); reset([p]);
  assert.equal((await activate("ice", { mode: "deployed", targetRef: "runner:enemy" })).ok, true);
  const actorId = state().progState["p|ice"].actorId;
  await op("ent.damage", { actorId, amount: 20 }, "gm");
  assert.equal(game.actors.has(actorId), true); assert.equal(p.system.rez.value, 0); assert.equal(p.system.isRezzed, true);
  assert.equal(state().defeated["p|ice"], true);
  await op("ent.restore", { actorId }, "gm"); assert.equal(state().defeated["p|ice"], undefined);
  await op("run.deactivateProgram", { pid: "p", programId: "ice" }); assert.equal(game.actors.has(actorId), false);
});
await test("equipment destruction prevention/source hooks preserve random and sourceRef", async () => {
  const p = item("b", "Armor", "defender", 7); p.system.isRezzed = true; reset([p]); preventDestroy = true;
  await op("run.progDamage", { pid: "p", programId: "b", amount: 7, effect: "destroy", random: true, sourceRef: "prog:enemy:dragon" }, "gm");
  assert.equal(state().destroyed["p|b"], undefined); assert.equal(state().defeated["p|b"], true);
  assert.equal(calls.find(c => c[0] === "beforeDestroy")[3].random, true);
  assert.equal(calls.some(c => c[0] === "afterDestroy"), false);
  preventDestroy = false;
  await op("run.progDamage", { pid: "p", programId: "b", amount: 1, effect: "destroy", sourceRef: "prog:enemy:dragon" }, "gm");
  assert.equal(calls.find(c => c[0] === "afterDestroy")[1], "prog:enemy:dragon");
});
await test("#3 Defender once per copy per run, one name active, another copy allowed after deactivate", async () => {
  reset([item("a1", "Armor", "defender", 7), item("a2", "Armor", "defender", 7)]);
  assert.equal((await activate("a1")).ok, true);
  assert.equal((await activate("a2")).error, "CRNS.Rules.OneDefender");
  await op("run.deactivateProgram", { pid: "p", programId: "a1" }); game.combat.round++;
  assert.equal((await activate("a1")).error, "CRNS.Rules.OncePerRun");
  assert.equal((await activate("a2")).ok, true);
});
await test("#4 Attacker integrated attack consumes exactly one action; no damage required", async () => {
  const p = item("glue", "Superglue", "antipersonnelattacker"); reset([p]);
  const app = { render: () => {}, state: {} };
  await actions.attackProgram(app, "p", runnerActor, "glue", { type: "click", shiftKey: false });
  assert.equal(state().participants.p.actions.value, 19); assert.equal(p.system.isRezzed, false);
  assert.equal(state().participants.p.lastProgramUse.programId, "glue");
  assert.equal(calls.filter(c => c[0] === "derez").length, 1);
  game.combat.round++;
  assert.equal((await activate("glue", { targetRef: "runner:enemy" })).error, "CRNS.Rules.OncePerRun");
});
await test("#4 cancelled native attack refunds reservation and once/run usage", async () => {
  const p = item("glue", "Superglue", "antipersonnelattacker"); reset([p]); allowRoll = false;
  await actions.attackProgram({ render: () => {}, state: {} }, "p", runnerActor, "glue", { type: "click" });
  assert.equal(state().participants.p.actions.value, 20); assert.equal(p.system.isRezzed, false);
  assert.equal(data.programUsed(state(), state().participants.p, "glue"), false);
  assert.equal(state().participants.p.runUsedIds.glue, undefined);
});
await test("activation owner checks, target class, action checks and concurrency", async () => {
  reset([item("a", "Hellbolt", "antipersonnelattacker")]);
  assert.equal(await op("run.activateProgram", { pid: "p", programId: "a", targetRef: "runner:enemy" }, "other"), false);
  assert.equal((await activate("a", { targetRef: "prog:enemy:missing" })).error, "CRNS.Rules.InvalidTarget");
  state().participants.p.actions.value = 0;
  assert.equal((await activate("a", { targetRef: "runner:enemy" })).error, "CRNS.Errors.NoActions");
  state().participants.p.actions.value = 2;
  const results = await Promise.all([activate("a", { targetRef: "runner:enemy" }), activate("a", { targetRef: "runner:enemy" })]);
  assert.equal(results.filter(r => r?.ok).length, 1); assert.equal(state().participants.p.actions.value, 1);
});
await test("#5 program round use survives Jack In/Out, same-round reset and reconnect", async () => {
  reset([item("b", "Worm", "booster", 7)]);
  await activate("b"); await op("run.jack", { pid: "p", in: false }); await op("run.jack", { pid: "p", in: true });
  await op("run.reset", { pid: "p" });
  assert.equal((await activate("b")).error, "CRNS.Errors.AlreadyRezzed");
  await op("session.connect", { pid: "p", actorUuid: runnerActor.uuid, archId: "a", userId: "player" }, "gm");
  assert.equal((await activate("b")).error, "CRNS.Errors.AlreadyRezzed");
  game.combat.round++; assert.equal((await activate("b")).ok, true);
});
await test("#5 two installed copies have independent round allowances", async () => {
  reset([item("b1", "Worm", "booster", 7), item("b2", "Worm", "booster", 7)]);
  assert.equal((await activate("b1")).ok, true); assert.equal((await activate("b2")).ok, true);
});
await test("#6 Slide attempt once/turn, password boundary and successful adjacent move", async () => {
  reset(); actor("ice", [], "Hellhound", "blackIce");
  settings.get("netArchs").a.floors[1].ice = [{ id: "iceDef", actorId: "ice", type: "hellhound" }];
  state().attachments = [{ archId: "a", iceId: "iceDef", pid: "p" }];
  settings.get("netArchs").a.floors[1].kind = "password";
  assert.equal((await op("run.slideAttempt", { pid: "p", targetRef: "ice:a:middle:iceDef", destination: 2 })).error, "CRNS.Rules.InvalidSlide");
  assert.equal(await op("run.slideAttempt", { pid: "p", targetRef: "ice:a:middle:iceDef", destination: 0 }), true);
  assert.equal((await op("run.slideAttempt", { pid: "p", targetRef: "ice:a:middle:iceDef", destination: 0 })).error, "CRNS.Rules.SlideUsed");
  assert.equal(await op("run.slideResolve", { archId: "a", iceId: "iceDef", pid: "p" }, "gm"), true);
  assert.equal(state().participants.p.floorIndex, 0); assert.equal(state().attachments.length, 0);
  game.combat.turn++;
  assert.equal((await op("run.slideAttempt", { pid: "p", targetRef: "demon:a:middle:d", destination: 1 })).error, "CRNS.Rules.InvalidSlide");
});
await test("#6 opposed Slide tie fails, greater total moves exactly one edge", async () => {
  for (const total of [10, 11]) {
    reset(); actor("ice", [], "Hellhound", "blackIce"); settings.get("netArchs").a.floors[1].ice = [{ id: "i", actorId: "ice", type: "hellhound" }];
    state().attachments = [{ archId: "a", iceId: "i", pid: "p" }];
    await op("run.slideAttempt", { pid: "p", targetRef: "ice:a:middle:i", destination: 0 });
    await main.handleSlideTest({ pid: "p", testRef: "ice:a:middle:i", runnerTotal: total });
    assert.equal(state().participants.p.floorIndex, total === 10 ? 1 : 0);
  }
});
await test("#7 Virus GM DV/action count, multiturm accumulation, equality fails, roll becomes removal DV", async () => {
  reset(); state().participants.p.floorIndex = 2;
  assert.equal(await op("run.virusConfigure", { pid: "p", dv: 12, actions: 9 }), false);
  assert.equal(await op("run.virusConfigure", { pid: "p", dv: 12, actions: 9 }, "gm"), true);
  state().participants.p.actions.value = 4;
  eq(await op("run.virusSpend", { pid: "p" }), { ok: true, ready: false, remaining: 5 });
  assert.equal((await op("run.abilityResult", { pid: "p", ability: "virus", total: 99 })).ok, false);
  await op("run.reset", { pid: "p" });
  assert.equal((await op("run.virusSpend", { pid: "p" })).ready, true);
  assert.equal((await op("run.abilityResult", { pid: "p", ability: "virus", total: 12 })).applied, false);
  assert.equal(state().participants.p.virusWork.spent, 0);
  state().participants.p.actions.value = 20;
  await op("run.virusSpend", { pid: "p" });
  assert.equal((await op("run.abilityResult", { pid: "p", ability: "virus", total: 13 })).applied, true);
  const virus = state().floorState["a:bottom"].viruses[0]; assert.equal(virus.dv, 13); assert.equal(virus.removalDV, 13); assert.equal(virus.actions, 9);
});
await test("fixed-DV boundary checks use strictly greater, Pathfinder sees equal-DV password", async () => {
  for (const [ability, kind] of [["backdoor", "password"], ["control", "controlnode"], ["eyedee", "file"]]) {
    for (const total of [9, 10, 11]) {
      reset(); Object.assign(settings.get("netArchs").a.floors[1], { kind, dv: 10 });
      assert.equal((await op("run.abilityResult", { pid: "p", ability, total })).applied, total > 10);
    }
  }
  reset(); state().participants.p.floorIndex = 0;
  Object.assign(settings.get("netArchs").a.floors[1], { kind: "password", dv: 10 });
  await op("run.abilityResult", { pid: "p", ability: "pathfinder", total: 10 });
  assert.equal(state().reveal.p.a, 2);
});
await test("#8 node once per turn from any floor and action spent only on success", async () => {
  reset(); settings.get("netArchs").a.floors[0].kind = "controlnode";
  state().floorState = { "a:entry": { control: { pid: "p", dv: 12 } } };
  assert.equal(await op("run.nodePulse", { archId: "a", floorId: "entry" }), true);
  assert.equal(state().participants.p.actions.value, 19);
  assert.equal((await op("run.nodePulse", { archId: "a", floorId: "entry" })).error, "CRNS.Rules.NodeUsed");
  assert.equal(state().participants.p.actions.value, 19);
  game.combat.turn++; assert.equal(await op("run.nodePulse", { archId: "a", floorId: "entry" }), true);
});
await test("#9 Scanner is a tracked Meat Action, never a NET action or free second action", async () => {
  reset(); assert.equal(nativeBridge.interfaceAbilities().find(a => a.key === "scanner").meat, true);
  assert.equal(await op("run.scanner", { pid: "p" }), true); assert.equal(state().participants.p.actions.value, 20);
  assert.equal((await op("run.spend", { pid: "p" })).error, "CRNS.Rules.MeatActionUsed");
  assert.equal((await op("run.scanner", { pid: "p" })).error, "CRNS.Rules.MeatActionUsed");
  game.combat.turn++; await op("run.spend", { pid: "p" });
  assert.equal((await op("run.scanner", { pid: "p" })).error, "CRNS.Rules.MeatActionUsed");
});
await test("#10 traps forbidden in started combat, allowed outside; #13 deploy has no SPEED test", async () => {
  reset([item("ice", "Hellhound", "blackice", 20)]);
  assert.equal((await activate("ice", { mode: "trap" })).error, "CRNS.Rules.TrapCombat");
  game.combat.started = false; assert.equal((await activate("ice", { mode: "trap" })).ok, true);
  reset([item("ice", "Hellhound", "blackice", 20)]);
  assert.equal((await activate("ice", { mode: "deployed", targetRef: "runner:enemy" })).ok, true);
  assert.equal(state().pendingTests.length, 0); assert.equal(calls.some(c => c[0] === "initiative"), true);
});
await test("#11 equal initiative remains unchanged, queueTs used (never +1)", async () => {
  reset(); game.combat.combatants.push({ id: "leader", actorId: "leader", initiative: 17 });
  await data.moveToTopOfQueue("ice");
  assert.equal(game.combat.combatants.find(c => c.actorId === "ice").initiative, 17);
  assert.equal(calls.find(c => c[0] === "queueFlag")[2], "queueTs");
});
await test("#12 actual bridge: program DEF and BI ATK stat rolls exclude Interface, keep native dialog/Luck", async () => {
  const p = item("p", "Killer", "blackice", 20); reset([p]);
  const event = { type: "click", ctrlKey: false };
  const def = await nativeBridge.rollProgram(runnerActor, "p", "def", event);
  assert.equal(def.statValue, 3); assert.equal(calls.some(c => c[0] === "createRoll"), false);
  assert.equal(calls.find(c => c[0] === "dialog")[1], event);
  calls.length = 0;
  const atk = await nativeBridge.rollProgram(runnerActor, "p", "atk", event); assert.equal(atk.statValue, 2);
  assert.equal(calls.some(c => c[0] === "createRoll"), false);
  p.system.class = "antiprogramattacker"; calls.length = 0;
  await nativeBridge.rollProgram(runnerActor, "p", "atk", event);
  assert.equal(calls.find(c => c[0] === "createRoll")[1], "cyberdeckProgram");
});
await test("#1 anti-program ambush requires eligible Rezzed program, chooses program not runner", async () => {
  for (const mode of ["none", "inactive", "defeated", "active", "blackice"]) {
    const p = item("b", "Worm", mode === "blackice" ? "blackice" : "booster", 7);
    p.system.isRezzed = ["active", "defeated", "blackice"].includes(mode); reset(mode === "none" ? [] : [p]);
    if (mode === "defeated") { state().defeated["p|b"] = true; p.system.rez.value = 0; }
    actor("killer", [], "Killer", "blackIce"); settings.get("netArchs").a.floors[0].ice = [{ id: "k", actorId: "killer", type: "killer" }];
    await op("session.move", { pid: "p", floorIndex: 0 });
    const expected = ["active", "blackice"].includes(mode);
    assert.equal(state().pendingTests.length, expected ? 1 : 0, mode);
    if (expected) { assert.equal(state().pendingTests[0].targetRef, "prog:p:b"); assert.equal(state().attachments[0].pid, "p"); }
  }
});
await test("SPEED tie avoids, loss selects pending program, cards never apply HP damage", async () => {
  for (const total of [10, 9]) {
    const p = item("b", "Worm", "booster", 7); p.system.isRezzed = true; reset([p]); actor("killer", [], "Killer", "blackIce");
    settings.get("netArchs").a.floors[0].ice = [{ id: "k", actorId: "killer", type: "killer" }];
    state().pendingTests = [{ id: "test", pid: "p", ref: "ice:a:entry:k", iceActorId: "killer", iceName: "Killer", antiProgram: true, targetRef: "prog:p:b" }];
    await main.handleSpeedTest({ testId: "test", runnerTotal: total });
    assert.equal(state().pendingTests.length, 0);
    assert.equal(state().targets.gm, total === 9 ? "prog:p:b" : "runner:enemy");
    assert.equal(calls.some(c => c[0] === "hpDamage"), false);
  }
});
await test("source metadata survives stash/apply and runner hook, equipment proxy forwards options", async () => {
  reset(); const app = {}, source = { sourceRef: "ice:a:entry:k", sourceName: "Killer", effect: "destroy", isBlackIce: true };
  actions.stashDamage(app, { resultTotal: 8 }, source); eq(app._lastDamageSource, source);
  await actions.applyTargetDamage("runner:enemy", app._lastDamage, app._lastDamageSource);
  eq(calls.find(c => c[0] === "hpDamage")[3], { ...source, sourceProgram: null });
  assert.equal(calls.filter(c => c[0] === "hpDamage").length, 1);
  assert.equal((await op("equipment.action", { pid: "p", action: "switch", deckId: "deck2" })).ok, true);
  eq(calls.find(c => c[0] === "equipmentAction")[2], { deckId: "deck2" });
});
await test("0-base-REZ Attacker is not defeated; actual defeated flag disables rolls", async () => {
  const p = item("s", "Sword"); p.system.isRezzed = true; reset([p]);
  let vm = actions.programVMs(runnerActor, state().participants.p, state()); assert.equal(vm[0].derezzed, false); assert.equal(vm[0].canRoll, true);
  state().defeated["p|s"] = true;
  vm = actions.programVMs(runnerActor, state().participants.p, state()); assert.equal(vm[0].canRoll, false);
  assert.equal(vm[0].tip, descriptions.programHint(p));
});
await test("disabled deck blocks action spending and ability results", async () => {
  reset(); state().participants.p.netEffects = { deckDisabled: true };
  assert.equal((await op("run.spend", { pid: "p" })).error, "CRNS.Equipment.DeckDisabled");
  assert.equal((await op("run.abilityResult", { pid: "p", ability: "cloak", total: 12 })).error, "CRNS.Equipment.DeckDisabled");
});
await test("random destruction excludes broken copies and retains source completion", async () => {
  reset([item("old", "Armor", "defender", 7), item("new", "Shield", "defender", 7)]);
  state().destroyed = { "p|old": true };
  await op("equipment.effect", { pid: "p", effect: "randomDestroy", sourceRef: "ice:a:entry:asp" }, "gm");
  assert.equal(state().destroyed["p|new"], true);
  assert.equal(calls.find(c => c[0] === "beforeDestroy")[2], "new");
  assert.equal(calls.find(c => c[0] === "beforeDestroy")[3].sourceRef, "ice:a:entry:asp");
  assert.equal(calls.find(c => c[0] === "afterDestroy")[1], "ice:a:entry:asp");
});
await test("native Interface Luck is consumed on the actor after a completed roll", async () => {
  const a = actor("lucky"); a.system.stats.luck = { value: 6 };
  NativeRoll.prototype.luck = 2; allowRoll = true;
  try { await nativeBridge.rollInterface(a, "defense", { type: "click", ctrlKey: false, metaKey: false }); }
  finally { delete NativeRoll.prototype.luck; }
  assert.equal(a.system.stats.luck.value, 4);
});
await test("removed Backup Drive loses stored copies even if the item is reinstalled", async () => {
  reset(); state().equipment = { p: { backups: { sword: { driveIds: ["drive"] } } } };
  await op("equipment.backupRemoved", { actorUuid: state().participants.p.actorUuid, driveIds: ["drive"] });
  eq(state().equipment.p.backups, {});
});
await test("disconnect does not silently restore destroyed programs", async () => {
  reset(); state().destroyed = { "p|sword": true };
  await op("session.disconnect", { pid: "p" });
  assert.equal(state().destroyed["p|sword"], true);
});
await test("attacker visuals preserve exact source/target, hit/miss and architecture without changing HP", async () => {
  reset([item("sword", "Sword")]);
  const request = { attackerProg: { pid: "p", programId: "sword", isAttacker: true }, targetRef: "runner:enemy" };
  main.postProgramAttackVisual(request, true);
  const visual = calls.find(c => c[0] === "socket" && c[2]?.kind === "attackVisual")?.[2];
  assert.equal(visual.archId, "a"); assert.equal(visual.ownerRef, "runner:p"); assert.equal(visual.sourceRef, "prog:p:sword");
  assert.equal(visual.targetRef, "runner:enemy"); assert.equal(visual.programName, "Sword"); assert.equal(visual.hit, true);
  assert.equal(calls.some(c => c[0] === "hpDamage"), false);
  calls.length = 0;
  game.actors.get("enemy").getOwnedItem = id => id === "armor" ? item("armor", "Armor", "defender", 7) : null;
  main.postProgramAttackVisual({ ...request, targetRef: "prog:enemy:armor" }, true);
  assert.equal(calls.find(c=>c[0]==="socket"&&c[2]?.kind==="attackVisual")?.[2].targetRef,"prog:enemy:armor","ordinary programs need no separate backing actor to receive FX");
  calls.length = 0;
  await main.handleRollRequest({ ...request, total: 10 });
  const pendingReply = calls.find(c => c[0] === "socket" && c[2]?.kind === "defenseRequest")?.[2];
  await main.handleDefenseResult({ defenseId: pendingReply.defenseId, pid: "enemy", defenseTotal: 10 });
  assert.equal(calls.find(c=>c[0]==="socket"&&c[2]?.kind==="attackVisual")[2].hit, false, "ties animate a miss");
  for (const invalidate of [()=>{state().participants.enemy.archId="elsewhere"},()=>{state().participants.p.jackedIn=false},()=>{runnerActor.getOwnedItem("sword").system.class="booster"}]) {
    reset([item("sword", "Sword")]); invalidate(); main.postProgramAttackVisual(request,true);
    assert.equal(calls.some(c=>c[0]==="socket"&&c[2]?.kind==="attackVisual"),false);
  }
});
await test("deferred player defence carries its attack target into the visual reply", async () => {
  reset([item("sword", "Sword")]);
  await main.handleRollRequest({ attackerProg: { pid:"p",programId:"sword",isAttacker:true }, targetRef:"runner:enemy", total:14 });
  const prompt=calls.find(c=>c[0]==="socket"&&c[2]?.kind==="defenseRequest")?.[2];
  assert.equal(prompt.targetRef,"runner:enemy"); assert.equal(prompt.attackerProg.programId,"sword");
  assert.equal(calls.some(c=>c[0]==="socket"&&c[2]?.kind==="attackVisual"),false,"no impact before player rolls defence");
});
function customItem(id, overrides = {}) {
  const definition = content.normalizeContent({ id: "stableCustom", kind: "program", name: "Авторская программа", class: "antipersonnelattacker",
    stats: { rez: 0 }, targets: ["runner"], netActions: 2, usage: "run", visual: { model: "sword", animation: "hellbolt" }, ...overrides });
  const program = item(id, definition.name, definition.class, definition.stats.rez);
  program.flags = { [constants.MODULE_ID]: { customContent: definition } };
  return program;
}
await test("custom snapshots drive native bridge identity, targets, cost, limits and exact cancelled refund", async () => {
  const p = customItem("custom"); reset([p]);
  assert.equal(bridge.programDefinition(p).id, "stableCustom", "the actual bridge imports and reads documentContent");
  p.name = "Переименовано";
  const started = await activate("custom", { targetRef: "runner:enemy" });
  assert.equal(started.ok, true); assert.equal(state().participants.p.actions.value, 18);
  const beforeCancel = state().participants.p.scoutActionSerial;
  await op("run.applyProgramEffect", { pid: "p", programId: p.id, activationId: started.activationId, cancelled: true });
  assert.equal(state().participants.p.actions.value, 20); assert.equal(state().participants.p.scoutActionSerial, beforeCancel - 1);
  const retry = await activate(p.id, { targetRef: "runner:enemy" }); assert.equal(retry.ok, true);
  await op("run.applyProgramEffect", { pid: "p", programId: p.id, activationId: retry.activationId });
  game.combat.round++;
  assert.equal((await activate(p.id, { targetRef: "runner:enemy" })).error, "CRNS.Rules.OncePerRun");
  calls.length = 0; main.postProgramAttackVisual({ attackerProg: { pid: "p", programId: p.id, isAttacker: true }, targetRef: "runner:enemy" }, true);
  assert.equal(calls.find(c => c[0] === "socket" && c[2]?.kind === "attackVisual")[2].visual.animation, "hellbolt");
});
await test("custom target subset rejects non-ICE programs and runner before action spend", async () => {
  const p = customItem("custom", { class: "antiprogramattacker", targets: ["blackIce"], usage: "round" }); reset([p]);
  const defense = item("armor", "Armor", "defender", 7); defense.system.isRezzed = true;
  actor("enemy", [defense]);
  assert.equal((await activate(p.id, { targetRef: "runner:enemy" })).error, "CRNS.Rules.InvalidTarget");
  assert.equal((await activate(p.id, { targetRef: "prog:enemy:armor" })).error, "CRNS.Rules.InvalidTarget");
  assert.equal(state().participants.p.actions.value, 20);
  defense.system.class = "blackice";
  assert.equal((await activate(p.id, { targetRef: "prog:enemy:armor" })).ok, true);
});
await test("custom Black ICE ambush honors target subset and native class despite renamed stock name", async () => {
  const p = item("armor", "Armor", "defender", 7); p.system.isRezzed = true; reset([p]);
  const ice = actor("customIce", [], "Killer", "blackIce"); ice.system.class = "antiprogram";
  const definition = content.normalizeContent({ id: "customAmbush", kind: "blackIce", name: "Лед", class: "antiprogram", targets: ["blackIce"], stats: { rez: 20 } });
  ice.flags = { [constants.MODULE_ID]: { customContent: definition } };
  settings.get("netArchs").a.floors[0].ice = [{ id: "ci", actorId: ice.id, type: "custom_customAmbush", content: definition }];
  await op("session.move", { pid: "p", floorIndex: 0 }); assert.equal(state().pendingTests.length, 0);
  p.system.class = "blackice";
  await op("session.move", { pid: "p", floorIndex: 0 }); assert.equal(state().pendingTests[0].targetRef, "prog:p:armor");
  reset([p]); ice.system.class = "antipersonnel"; ice.flags = {}; game.actors.set(ice.id, ice);
  settings.get("netArchs").a.floors[0].ice = [{ id: "ci", actorId: ice.id, type: "killer" }];
  await op("session.move", { pid: "p", floorIndex: 0 }); assert.equal(state().pendingTests[0].targetRef, "runner:p", "Actor class wins over renamed table identity");
});
await test("Super Slide allows two resolved attempts, blocks pending/third and resets on next turn", async () => {
  reset(); slideLimit = 2; actor("ice", [], "Hellhound", "blackIce");
  settings.get("netArchs").a.floors[1].ice = [{ id: "iceDef", actorId: "ice", type: "hellhound" }];
  state().attachments = [{ archId: "a", iceId: "iceDef", pid: "p" }];
  const attempt = () => op("run.slideAttempt", { pid: "p", targetRef: "ice:a:middle:iceDef", destination: 0 });
  assert.equal(await attempt(), true); assert.equal((await attempt()).error, "CRNS.Rules.SlideUsed");
  await op("run.clearSlideAttempt", { pid: "p", targetRef: "ice:a:middle:iceDef" }, "gm");
  assert.equal(await attempt(), true);
  await op("run.clearSlideAttempt", { pid: "p", targetRef: "ice:a:middle:iceDef" }, "gm");
  assert.equal((await attempt()).error, "CRNS.Rules.SlideUsed"); game.combat.turn++;
  assert.equal(await attempt(), true);
});
await test("Scout action serial expires on action/move and survives reconnect", async () => {
  reset(); await op("run.spend", { pid: "p" }); assert.equal(state().participants.p.scoutActionSerial, 1);
  await op("session.move", { pid: "p", floorIndex: 0 }); assert.equal(state().participants.p.scoutActionSerial, 2);
  await op("session.connect", { pid: "p", actorUuid: runnerActor.uuid, archId: "a", userId: "player" }, "gm");
  assert.equal(state().participants.p.scoutActionSerial, 2);
});
await test("Jack Out releases only this runner's Control Nodes and re-JackIn cannot reuse them", async () => {
  reset(); state().floorState = { "a:middle": { control: { pid: "p", dv: 15 } }, "a:bottom": { control: { pid: "enemy", dv: 20 } } };
  assert.equal(await op("run.jack", { pid: "p", in: false }), true);
  assert.equal(state().floorState["a:middle"].control, null);
  assert.equal(state().floorState["a:bottom"].control.pid, "enemy");
  await op("run.jack", { pid: "p", in: true });
  assert.equal(await op("run.nodePulse", { archId: "a", floorId: "middle" }), false);
});
await test("GM removes a single mistaken effect while players cannot clear it", async () => {
  reset(); state().participants.p.netEffects = { fire: true, deckDisabled: true };
  assert.equal(await op("equipment.clearEffect", { pid: "p", key: "fire" }), false);
  assert.equal(await op("equipment.clearEffect", { pid: "p", key: "fire" }, "gm"), true);
  eq(state().participants.p.netEffects, { deckDisabled: true });
  assert.equal(await op("equipment.clearEffect", { pid: "p", key: "__proto__" }, "gm"), false);
});
await test("program availability explains custom cost and per-run lock without spending actions", async () => {
  const p = customItem("custom"); reset([p]); game.user = users.get("player");
  state().participants.p.actions.value = 1;
  const part = state().participants.p;
  let view = actions.programVMs(runnerActor, part, state())[0];
  assert.equal(view.activateDisabled, true); assert.equal(view.activateReason, "CRNS.Errors.NoActions"); assert.equal(view.actionCost, 2);
  part.actions.value = 20; part.runUsedIds = { custom: true };
  view = actions.programVMs(runnerActor, part, state())[0];
  assert.equal(view.activateReason, "CRNS.Rules.OncePerRun"); assert.equal(state().participants.p.actions.value, 20);
});
await test("closing or rerendering during action-bar resize removes window listeners", async () => {
  reset(); const listeners = new Map(), handleEvents = new Map(); let resizing = true;
  context.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  context.document = { body: { classList: { add: () => { resizing = true; }, remove: () => { resizing = false; } } } };
  const handle = { addEventListener: (name, fn) => handleEvents.set(name, fn) };
  const root = { getBoundingClientRect: () => ({ height: 760 }), querySelector: () => ({ getBoundingClientRect: () => ({ height: 290 }) }), style: { setProperty: () => {} } };
  const html = { find: selector => selector.includes("bar-resize") ? [handle] : [root], filter: () => [root] };
  const app = {};
  actions.wireBarResize(app, html); handleEvents.get("pointerdown")({ preventDefault() {}, clientY: 500 });
  assert.equal(listeners.size, 3); assert.equal(resizing, true);
  actions.cleanup(app); assert.equal(listeners.size, 0); assert.equal(resizing, false);
  actions.wireBarResize(app, html); handleEvents.get("pointerdown")({ preventDefault() {}, clientY: 500 });
  actions.wireBarResize(app, html); assert.equal(listeners.size, 0); assert.equal(resizing, false); actions.cleanup(app);
});
await test("last runner resets password defenses while an ally holds the run and persistent markers survive", async () => {
  reset(); state().floorState = { "a:middle": { breached: true, viruses: [{ id: "persistent" }] } };
  state().cloaks = { a: [{ id: "hiddenTrail", pid: "p", dv: 12 }] };
  await op("run.jack", { pid: "p", in: false });
  assert.equal(state().floorState["a:middle"].breached, true, "ally still holds the architecture");
  await op("run.jack", { pid: "enemy", in: false }, "other");
  assert.equal(state().floorState["a:middle"].breached, false);
  assert.equal(state().floorState["a:middle"].viruses[0].id, "persistent");
  assert.equal(state().cloaks.a[0].id, "hiddenTrail");
});
await test("deleting a backing Black ICE can retire its surviving Item without an equipped deck", async () => {
  const p = item("backing", "Custom ICE", "blackice", 20); p.system.isRezzed = true; p.system.rez.value = 5;
  reset([p]); runnerActor.getEquippedCyberdeck = () => null;
  assert.equal(await nativeBridge.derezProgram(runnerActor, p.id), true);
  assert.equal(p.system.isRezzed, false); assert.equal(p.system.rez.value, 20);
});
function setCombatant(actorId, id = `turn_${actorId}`) {
  const entry = { id, actorId, actor: game.actors.get(actorId) };
  game.combat.combatant = entry;
  if (!game.combat.combatants.get(id)) game.combat.combatants.push(entry);
  return entry;
}
await test("v12 post-update turn hook refreshes the incoming runner, never the outgoing runner", async () => {
  reset(); const combat = game.combat;
  setCombatant("r"); state().participants.p.actions.value = 1; state().participants.enemy.actions.value = 0;
  assert.equal(hooks.has("combatTurn"), false, "the pre-update hook must not reset actions");
  assert.equal(hooks.has("combatRound"), false);
  assert.equal(state().participants.p.actions.value, 1);
  combat.turn = 1; const incoming = setCombatant("enemy");
  hooks.get("combatTurnChange")(combat, { round: 1, turn: 0, combatantId: "turn_r" }, { round: 1, turn: 1, combatantId: incoming.id });
  await op("ping", {}, "gm");
  assert.equal(state().participants.p.actions.value, 1);
  assert.equal(state().participants.enemy.actions.value, 5);
  assert.equal(calls.filter(c => c[0] === "equipTurn").length, 1);
});
await test("turn start restores the native action maximum plus equipment once and retains program round usage", async () => {
  reset([item("worm", "Worm", "booster", 7)]); await activate("worm");
  state().participants.p.actions.value = 0; turnBonus = 1;
  const current = setCombatant("r"), payload = { combatId: game.combat.id, round: 1, combatantId: current.id };
  assert.equal(await op("run.startTurn", payload, "player"), false);
  assert.equal(await op("run.startTurn", payload, "gm"), true);
  assert.equal(state().participants.p.actions.value, 6); assert.equal(state().participants.p.actions.max, 6);
  assert.equal(data.programUsed(state(), state().participants.p, "worm"), true);
  await op("run.spend", { pid: "p" });
  assert.equal(await op("run.startTurn", payload, "gm"), false);
  assert.equal(state().participants.p.actions.value, 5, "duplicate start never refills spent actions");
  const equipmentStarts = calls.filter(c => c[0] === "equipTurn").length;
  game.combat.turn = 3;
  hooks.get("combatTurnChange")(game.combat, { round: 1, turn: 0, combatantId: current.id }, { round: 1, turn: 3, combatantId: current.id });
  await op("ping", {}, "gm"); assert.equal(state().participants.p.actions.value, 5, "initiative reorder is not a new turn");
  assert.equal(calls.filter(c => c[0] === "equipTurn").length, equipmentStarts);
  game.combat.round = 2;
  assert.equal(await op("run.startTurn", { ...payload, round: 2 }, "gm"), true);
  assert.equal(state().participants.p.actions.value, 6);
  assert.equal(data.programUsed(state(), state().participants.p, "worm"), false);
});
await test("turn start recognizes world runners in unlinked tokens and rejects a different synthetic token", async () => {
  reset(); const current = setCombatant("r"); current.actor = { ...runnerActor, uuid: "Scene.s.Token.t.Actor.r" };
  assert.equal(data.combatantMatchesActor(current, "Actor.r", "r"), true);
  assert.equal(data.combatantMatchesActor(current, "Scene.s.Token.other.Actor.r", "r"), false);
  state().participants.p.actions.value = 0;
  assert.equal(await op("run.startTurn", { combatId: game.combat.id, round: 1, combatantId: current.id }, "gm"), true);
  assert.equal(state().participants.p.actions.value, 5);
});
await test("program and unrelated turns do not refill the owner; stale turn requests do nothing", async () => {
  reset(); actor("iceTurn", [], "Hellhound", "blackIce"); const current = setCombatant("iceTurn");
  state().participants.p.actions.value = 1;
  const payload = { combatId: game.combat.id, round: 1, combatantId: current.id };
  assert.equal(await op("run.startTurn", payload, "gm"), false); assert.equal(state().participants.p.actions.value, 1);
  setCombatant("r");
  assert.equal(await op("run.startTurn", payload, "gm"), false);
  assert.equal(await op("run.startTurn", { ...payload, combatId: "other" }, "gm"), false);
});
await test("combat start, stop and restart restore the first runner and clear the turn dedup marker", async () => {
  reset(); const current = setCombatant("r"); state().participants.p.actions.value = 0;
  const event = hooks.get("combatTurnChange");
  event(game.combat, { round: 0 }, { round: 1, combatantId: current.id }); await op("ping", {}, "gm");
  assert.equal(state().participants.p.actions.value, 5);
  game.combat.started = false; game.combat.round = 0;
  hooks.get("updateCombat")(game.combat); await op("ping", {}, "gm");
  assert.equal(state().participants.p.lastCombatTurn, undefined);
  state().participants.p.actions.value = 0; game.combat.started = true; game.combat.round = 1;
  event(game.combat, { round: 0 }, { round: 1, combatantId: current.id }); await op("ping", {}, "gm");
  assert.equal(state().participants.p.actions.value, 5);
});
await test("only the primary GM handles a combat turn notification", async () => {
  reset(); const current = setCombatant("r"); state().participants.p.actions.value = 0;
  const secondary = { id: "zzGM", isGM: true, active: true }; users.set(secondary.id, secondary);
  const previous = { round: 0 }, next = { round: 1, combatantId: current.id };
  for (const user of [users.get("player"), secondary]) {
    game.user = user; hooks.get("combatTurnChange")(game.combat, previous, next); await op("ping", {}, "gm");
    assert.equal(state().participants.p.actions.value, 0);
  }
  game.user = users.get("gm"); hooks.get("combatTurnChange")(game.combat, previous, next); await op("ping", {}, "gm");
  assert.equal(state().participants.p.actions.value, 5); users.delete(secondary.id);
});
await test("post-update turn handling retains Demon refresh and applies fire to the actual outgoing runner once", async () => {
  reset(); const combat = game.combat, previous = setCombatant("r");
  const demon = actor("demonTurn", [], "Imp", "demon"); setCombatant(demon.id);
  state().participants.p.netEffects = { fire: true }; state().demonState[demon.id] = { value: 0, max: 2 };
  const event = hooks.get("combatTurnChange"), before = { round: 1, turn: 0, combatantId: previous.id }, after = { round: 1, turn: 1, combatantId: combat.combatant.id };
  combat.turn = 1; combat.previous = { combatantId: "wrongOldState" };
  event(combat, before, after); await op("ping", {}, "gm");
  assert.equal(state().demonState[demon.id].value, 2);
  assert.equal(calls.filter(c => c[0] === "hpDamage").length, 1);
  assert.equal(calls.find(c => c[0] === "hpDamage")[1][0], "r");
  state().demonState[demon.id].value = 1;
  event(combat, before, after); await op("ping", {}, "gm");
  assert.equal(state().demonState[demon.id].value, 1); assert.equal(calls.filter(c => c[0] === "hpDamage").length, 1);
});
await test("GM removes only the requested architecture Cloak; player cannot remove one", async () => {
  reset();
  state().cloaks = { a: [{ id: "first", pid: "p", dv: 12 }, { id: "second", pid: "enemy", dv: 9 }], other: [{ id: "first", pid: "p", dv: 8 }] };
  const payload = { archId: "a", kind: "cloak", id: "first" };
  assert.equal(await op("fx.clear", payload), false);
  assert.equal(state().cloaks.a.length, 2);
  assert.equal(await op("fx.clear", payload, "gm"), true);
  eq(state().cloaks.a.map(c => c.id), ["second"]);
  assert.equal(state().cloaks.other.length, 1);
  assert.equal(await op("fx.clear", { ...payload, id: "second" }, "gm"), true);
  eq(state().cloaks.a, []);
});
function actionClick(app, action, dataset) {
  const handlers = new Map();
  const html = { find: selector => ({ on(type, fn) { handlers.set(`${selector}:${type}`, fn); return this; } }) };
  actions.activateListeners(app, html);
  return handlers.get(`[data-action="${action}"]:click`)({ preventDefault() {}, stopPropagation() {}, currentTarget: { dataset }, originalEvent: { type: "click", ctrlKey: false } });
}
await test("Scanner button uses its real descriptor, rolls once and consumes only the Meat Action even before Jack In", async () => {
  reset(); state().participants.p.jackedIn = false; state().participants.p.actions.value = 0;
  const app = { state: {}, render() {} }, part = { ...state().participants.p, pid: "p" };
  const ab = actions.buildRunnerVM(app, { pid: "p", part, actor: runnerActor }, state()).abilities.find(a => a.key === "scanner");
  assert.equal(ab.free, true); assert.equal(ab.disabled, false); assert.equal(ab.reason, "");
  const button = { pid: "p", actorId: "r", ability: ab.key, free: String(ab.free) };
  await actionClick(app, "ability-roll", button);
  assert.equal(calls.filter(c => c[0] === "roll").length, 1);
  assert.equal(state().participants.p.actions.value, 0);
  assert.equal(state().participants.p.meatActionTurn, data.turnKey(state().participants.p));
  await actionClick(app, "ability-roll", button);
  assert.equal(calls.filter(c => c[0] === "roll").length, 1);
});
await test("Backdoor button spends one action and applies only a successful native check", async () => {
  reset(); Object.assign(settings.get("netArchs").a.floors[1], { kind: "password", dv: 9 });
  await actionClick({ state: {}, render() {} }, "ability-roll", { pid: "p", actorId: "r", ability: "backdoor", free: "false" });
  assert.equal(state().participants.p.actions.value, 19);
  assert.equal(state().floorState["a:middle"].breached, true);
  assert.equal(calls.filter(c => c[0] === "roll").length, 1);
});
await test("cancelling an Interface dialog leaves NET and Meat Action budgets untouched", async () => {
  for (const ability of ["backdoor", "scanner"]) {
    reset(); allowRoll = false;
    await actionClick({ state: {}, render() {} }, "ability-roll", { pid: "p", actorId: "r", ability, free: String(ability === "scanner") });
    assert.equal(state().participants.p.actions.value, 20, ability);
    assert.equal(state().participants.p.meatActionTurn, undefined, ability);
    assert.equal(state().participants.p.netActionTurn, undefined, ability);
    assert.equal(calls.filter(c => c[0] === "roll").length, 0);
    assert.equal(state().floorState["a:middle"], undefined);
  }
});
await test("Slide dialog cancellation does not reserve an attempt; confirming spends once and preserves its target", async () => {
  reset(); state().participants.p.floorIndex = 0;
  actor("hound", [], "Hellhound", "blackIce");
  settings.get("netArchs").a.floors[0].ice = [{ id: "h", type: "hellhound", actorId: "hound" }];
  state().attachments = [{ archId: "a", iceId: "h", pid: "p" }];
  state().targets.gm = "ice:a:entry:h";
  const app = { state: {}, render() {} }, button = { pid: "p", actorId: "r", ability: "slide", free: "false" };
  allowRoll = false; await actionClick(app, "ability-roll", button);
  assert.equal(state().participants.p.actions.value, 20);
  assert.equal(state().participants.p.slideAttempt, undefined);
  assert.equal(state().participants.p.slideCount, undefined);
  allowRoll = true; await actionClick(app, "ability-roll", button);
  assert.equal(state().participants.p.actions.value, 19);
  assert.equal(state().participants.p.slideCount, 1);
  eq(state().participants.p.slideAttempt, { targetRef: "ice:a:entry:h", destination: 1 });
  const notify = calls.find(c => c[0] === "socket" && c[2].kind === "slideTest")[2];
  assert.equal(notify.testRef, "ice:a:entry:h");
  await actionClick(app, "ability-roll", button);
  assert.equal(state().participants.p.actions.value, 19);
  assert.equal(calls.filter(c => c[0] === "roll").length, 1);
});
await test("an accepted dialog cannot roll or apply a floor effect when the authoritative budget is empty", async () => {
  reset(); state().participants.p.actions.value = 0;
  await actionClick({ state: {}, render() {} }, "ability-roll", { pid: "p", actorId: "r", ability: "backdoor", free: "false" });
  assert.equal(calls.filter(c => c[0] === "roll").length, 0);
  assert.equal(state().floorState["a:middle"], undefined);
});
await test("Demon Interface and Zap dialogs spend only after confirmation and reject an empty counter", async () => {
  for (const action of ["demon-action", "demon-zap"]) {
    reset(); actor("imp", [], "Imp", "demon"); state().demonState.imp = { value: 2, max: 2 };
    const app = { state: {}, render() {} };
    allowRoll = false; await actionClick(app, action, { actorId: "imp" });
    assert.equal(state().demonState.imp.value, 2, action);
    assert.equal(calls.filter(c => c[0] === "roll").length, 0);
    allowRoll = true; await actionClick(app, action, { actorId: "imp" });
    assert.equal(state().demonState.imp.value, 1, action);
    state().demonState.imp.value = 0;
    await actionClick(app, action, { actorId: "imp" });
    assert.equal(state().demonState.imp.value, 0);
    assert.equal(calls.filter(c => c[0] === "roll").length, 1);
  }
});
await test("Demon CN uses the Actor's current value and native d10 stat roll, never a fixed chat result", async () => {
  reset(); const demon = actor("imp", [], "Imp", "demon"); demon.system.stats.combatNumber = 18;
  settings.get("netArchs").a.floors[0].demon = { id: "d", type: "imp", actorId: demon.id };
  state().demonState.imp = { value: 2, max: 2 };
  const app = { state: {}, render() {} };
  assert.equal(actions.buildEntityVM(app, "demon:a:entry:d", state()).combatNumber, 18);
  allowRoll = false; await actionClick(app, "demon-cn", { actorId: "imp", cn: "18" });
  assert.equal(state().demonState.imp.value, 2);
  assert.equal(calls.filter(c => c[0] === "roll").length, 0);
  allowRoll = true; await actionClick(app, "demon-cn", { actorId: "imp", cn: "18" });
  assert.equal(state().demonState.imp.value, 1);
  assert.equal(calls.find(c => c[0] === "createStatRoll")[1], "combatNumber");
  assert.equal(calls.filter(c => c[0] === "roll").length, 1);
});
await test("folder/architecture lifecycle: create, rename, cycle rejection, edit, duplicate, tabs and recursive delete", async () => {
  reset(); settings.set("netTree", []); settings.set("treeState", {});
  assert.equal(await op("tree.createFolder", { name: "Denied" }), false);
  await op("tree.createFolder", { name: "Parent" }, "gm");
  const parent = settings.get("netTree")[0].id;
  await op("tree.createFolder", { name: "Child", parentId: parent }, "gm");
  const child = settings.get("netTree")[1].id;
  assert.equal((await op("tree.move", { nodeId: parent, parentId: child }, "gm")).error, "CRNS.Errors.Cycle");
  await op("tree.toggle", { nodeId: parent, open: true }, "gm"); assert.equal(settings.get("treeState")[parent], true);
  const created = await op("tree.createArch", { parentId: child, name: "Office" }, "gm");
  const node = settings.get("netTree").find(n => n.archId === created.archId);
  await op("tree.rename", { nodeId: node.id, name: "Office renamed" }, "gm");
  assert.equal(settings.get("netArchs")[created.archId].name, "Office renamed");
  const draft = clone(settings.get("netArchs")[created.archId]); draft.floors.push({ id: "password", kind: "password", dv: 10, ice: [] });
  assert.equal(await op("arch.update", { archId: created.archId, arch: draft }, "gm"), true);
  const copied = await op("arch.duplicate", { archId: created.archId }, "gm");
  assert.equal(settings.get("netTree").find(n => n.archId === copied.archId).parentId, child);
  assert.equal(settings.get("netArchs")[copied.archId].floors.length, 2);
  assert.notEqual(settings.get("netArchs")[copied.archId].floors[0].id, draft.floors[0].id);
  for (const archId of [created.archId, copied.archId, created.archId]) await op("tabs.open", { archId }, "gm");
  eq(state().tabs, [created.archId, copied.archId]);
  assert.equal(await op("tabs.activate", { archId: copied.archId }, "gm"), true);
  assert.equal(await op("tabs.close", { archId: copied.archId }, "gm"), true);
  assert.equal(state().activeTab, created.archId);
  assert.equal(await op("session.connect", { pid: "p", actorUuid: "Actor.r", userId: "player", archId: created.archId }, "gm"), true);
  assert.equal(state().participants.p.actions.value, 4);
  await op("tree.delete", { nodeId: parent }, "gm");
  eq(settings.get("netTree"), []); eq(state().tabs, []);
  assert.equal(settings.get("netArchs")[created.archId], undefined);
  assert.equal(settings.get("netArchs")[copied.archId], undefined);
  assert.equal(state().participants.p.jackedIn, false);
  assert.equal(game.actors.has("r"), true);
});
await test("imported names remain text in folder and architecture deletion confirmations", async () => {
  reset(); const name = '<img src=x onerror="window.injected=true">';
  settings.set("netTree", [{ id: "file", type: "arch", archId: "a", name }, { id: "folder", type: "folder", name }]);
  const tree = load("scripts/apps/tree.js", { ...constants, ...data, snapshotEntityActor: bridge.snapshotEntityActor, promptText: async () => null });
  const handlers = new Map(), dialogs = [], previousFormat = game.i18n.format;
  context.Dialog = { confirm: async options => { dialogs.push(options.content); return false; } };
  game.i18n.format = (key, data) => `Delete ${data.name}?`;
  try {
    tree.activateListeners({ state: {} }, { find: selector => ({ 0: selector === ".crns-tree" ? {} : undefined, on(type, fn) { handlers.set(`${selector}:${type}`, fn); return this; } }) });
    for (const [action, nodeId] of [["arch-delete", "file"], ["folder-delete", "folder"]]) {
      await handlers.get(`[data-action="${action}"]:click`)({ currentTarget: { closest: () => ({ dataset: { nodeId } }) } });
    }
    assert.equal(dialogs.length, 2);
    for (const html of dialogs) { assert.equal(html.includes("<img"), false); assert.equal(html.includes("&lt;img"), true); }
    assert.equal(settings.get("netTree").length, 2);
  } finally { game.i18n.format = previousFormat; delete context.Dialog; }
});
await test("stale or non-folder create/import parents cannot produce invisible orphan entries", async () => {
  reset(); settings.set("netTree", [{ id: "file", type: "arch", archId: "a", parentId: "", name: "A" }]);
  const before = clone(Object.fromEntries(settings));
  for (const parentId of ["deletedFolder", "file"]) {
    assert.equal(await op("tree.createFolder", { parentId, name: "Orphan" }, "gm"), false);
    assert.equal(await op("tree.createArch", { parentId, name: "Orphan" }, "gm"), false);
    assert.equal(await op("arch.import", { parentId, arch: { name: "Orphan", floors: [{ id: "f", kind: "custom", ice: [] }] } }, "gm"), false);
    eq(Object.fromEntries(settings), before);
  }
});
await test("Scout's immediate free Pathfinder is claimed after confirming either UI path", async () => {
  for (const equipmentPanel of [false, true]) {
    reset(); state().equipment = { p: { scoutPending: true, scoutSerial: 0 } };
    const app = { state: { selection: "runner:p" }, render() {} };
    let click;
    if (equipmentPanel) {
      let dialog, open;
      const panel = load("scripts/apps/equipment-panel.js", { ...constants, ...data, bridge, equipmentProfile: () => ({ keys: [], freePathfinder: true, range: 6 }), equipmentHint: () => "" });
      context.Dialog = class { constructor(options) { dialog = options; } render() {} };
      panel.activateListeners(app, { find: () => ({ on: (_event, fn) => { open = fn; } }) });
      open({ preventDefault() {} }); click = dialog.buttons.scout.callback;
    } else click = () => actionClick(app, "ability-roll", { pid: "p", actorId: "r", ability: "pathfinder", free: "false" });
    try {
      allowRoll = false; await click();
      assert.equal(calls.filter(c => c[0] === "equipmentAction" && c[1] === "scout").length, 0);
      assert.equal(state().participants.p.actions.value, 20);
      allowRoll = true; await click();
      assert.equal(calls.filter(c => c[0] === "equipmentAction" && c[1] === "scout").length, 1);
      assert.equal(state().participants.p.actions.value, 20);
      assert.equal(calls.filter(c => c[0] === "roll").length, 1);
    } finally { delete context.Dialog; }
  }
});
console.log(`${passed} rules regression groups passed.`);
