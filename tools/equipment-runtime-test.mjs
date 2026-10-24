import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const root = new URL("../", import.meta.url);
const game = { combat: null };
const actors = new Map();
const ctx = vm.createContext({ game, fromUuidSync: id => actors.get(id), console });
function load(path, deps = {}) {
  const source = readFileSync(new URL(path, root), "utf8");
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]);
  return vm.runInContext(`(deps=>{const {${Object.keys(deps).filter(k => !names.includes(k))}}=deps;${source.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "")};return {${names}};})`, ctx)(deps);
}
const catalog = load("scripts/reference-catalog.js"), equipment = load("scripts/equipment.js", catalog);
const runtime = load("scripts/equipment-runtime.js", { ...equipment, protectionVerdict: equipment.equipmentProtection });
function fixture(deckName = "Cyberdeck", gear = [], names = ["Armor", "Armor", "Speedy Gonzales", "Speedy Gonzales", "Sword"]) {
  const items = new Map();
  const deck = { id: "deck", name: deckName, type: "cyberdeck", system: { equipped: "equipped", installedItems: { slots: 99, list: [] } } };
  const actor = { id: "actor", items, getOwnedItem: id => items.get(id), getEquippedCyberdeck: () => deck };
  let i = 0;
  for (const name of [...names, ...gear]) {
    const hardware = gear.includes(name), id = `${++i}`;
    const item = { id, type: hardware ? "itemUpgrade" : "program", name,
      system: { class: name === "Armor" ? "defender" : "booster", isRezzed: false, rez: { value: 7, max: 7 }, size: 1 },
      async update(patch) { for (const [key, value] of Object.entries(patch)) {
        if (key === "name") this.name = value;
        else { const keys = key.split("."); let obj = this; for (const key of keys.slice(0, -1)) obj = obj[key] ||= {}; obj[keys.at(-1)] = value; }
      } } };
    items.set(id, item); deck.system.installedItems.list.push(id);
  }
  actors.set(actor.id, actor);
  const session = { participants: { p: { actorUuid: actor.id, jackedIn: true, actions: { value: 4, max: 4 }, rezzed: {}, runUsedIds: {} } }, destroyed: {} };
  const bridge = { getDeck: a => a?.getEquippedCyberdeck(), installedPrograms: d => d.system.installedItems.list.map(id => items.get(id)).filter(i => i.type === "program"),
    rezProgram: async (a, id) => { items.get(id).system.isRezzed = true; return true; },
    derezProgram: async (a, id) => { items.get(id).system.isRezzed = false; return true; }, restoreEntity: async () => true };
  return { actor, deck, items, session, bridge };
}
let count = 0;
async function test(name, fn) { await fn(); console.log(`OK ${name}`); count++; }
await test("Hummingbird grants exactly one action", () => {
  assert.equal(runtime.netActionBonus(fixture("Hummingbird").actor), 1);
});
await test("Warrior free Armor costs no NET action and records per-run use", async () => {
  const { actor, session, bridge, items } = fixture("Microtech Warrior");
  await runtime.onEquipmentJackIn(session, "p", actor, bridge);
  assert.equal(items.get("1").system.isRezzed, true); assert.equal(session.participants.p.actions.value, 4);
  assert.equal(session.participants.p.runUsedIds["1"], true);
});
await test("Kestrel activates two separate Speedy copies", async () => {
  const { actor, session, bridge, items } = fixture("Kestrel 2");
  await runtime.onEquipmentJackIn(session, "p", actor, bridge);
  assert.equal(items.get("3").system.isRezzed && items.get("4").system.isRezzed, true);
});
await test("Sequencer waits for next turn and chooses unused Armor", async () => {
  const { actor, session, bridge, items } = fixture("Cyberdeck", ["Defense Sequencer"]);
  items.get("1").system.isRezzed = true; session.participants.p.runUsedIds["1"] = true;
  runtime.queueArmor(session, "p", actor, items.get("1"));
  items.get("1").system.rez.value = 0; session.defeated = { "p|1": true };
  assert.equal(items.get("2").system.isRezzed, false);
  await runtime.onEquipmentTurn(session, "p", actor, bridge);
  assert.equal(items.get("2").system.isRezzed, true);
  assert.equal(items.get("1").system.isRezzed, true);
});
await test("Snaketrap blocks only the first random destruction", async () => {
  const { actor, session, bridge } = fixture("Cyberdeck", ["Snaketrap"]);
  assert.equal(await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge, { random: true }), false);
  assert.equal(await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge, { random: true }), true);
});
await test("Backup restore retains once-per-run usage", async () => {
  const { actor, session, bridge } = fixture("Cyberdeck", ["Backup Drive"]);
  session.participants.p.runUsedIds["1"] = true;
  await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge);
  session.destroyed["p|1"] = true;
  assert.equal((await runtime.equipmentAction(session, "p", "restore", actor, bridge)).ok, true);
  assert.equal(session.destroyed["p|1"], undefined); assert.equal(session.participants.p.runUsedIds["1"], true);
});
await test("Phoenix restores only on safe Jack Out", async () => {
  const { actor, session, bridge } = fixture("Phoenix");
  await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge); session.destroyed["p|1"] = true;
  await runtime.onEquipmentJackOut(session, "p", actor, bridge, { safe: false }); assert.equal(session.destroyed["p|1"], true);
  await runtime.onEquipmentJackOut(session, "p", actor, bridge, { safe: true }); assert.equal(session.destroyed["p|1"], undefined);
});
await test("Swifty allows exactly two Cloak rolls for one action once per run", async () => {
  const { actor, session, bridge } = fixture("Cyberdeck", ["Swifty Clean"]);
  assert.equal((await runtime.equipmentAction(session, "p", "swifty", actor, bridge)).rolls, 2);
  assert.equal(session.participants.p.actions.value, 3);
  assert.equal(await runtime.equipmentAction(session, "p", "swifty", actor, bridge), false);
});
await test("Training deck doubles direct brain damage", async () => {
  const { actor, session, bridge } = fixture("Kirama Training Deck");
  assert.equal(await runtime.equipmentBrainDamage(session, "p", actor, 7, bridge), 14);
});
await test("Insulated Wiring and KRASH Barrier protections do not imply each other", () => {
  const { actor } = fixture("Cyberdeck", ["Insulated Wiring"]);
  assert.equal(runtime.equipmentProtection(actor, "ignite"), true);
  assert.equal(runtime.equipmentProtection(actor, "forceJackOut"), false);
});
await test("Shield stops one non-ICE brain hit, retaining 0 REZ until deactivation", async () => {
  const { actor, session, bridge, items } = fixture("Cyberdeck", [], ["Shield"]);
  items.get("1").system.isRezzed = true;
  assert.equal(await runtime.equipmentBrainDamage(session, "p", actor, 10, bridge, { isBlackIce: false }), 0);
  assert.equal(items.get("1").system.isRezzed, true);
  assert.equal(items.get("1").system.rez.value, 0);
  assert.equal(session.defeated["p|1"], true);
  assert.equal(await runtime.equipmentBrainDamage(session, "p", actor, 5, bridge, { isBlackIce: false }), 5);
});
await test("Cancelling both Swifty rolls refunds its reservation exactly once", async () => {
  const { actor, session, bridge } = fixture("Cyberdeck", ["Swifty Clean"]);
  await runtime.equipmentAction(session, "p", "swifty", actor, bridge);
  assert.equal((await runtime.equipmentAction(session, "p", "swiftyCancel", actor, bridge)).ok, true);
  assert.equal(session.participants.p.actions.value, 4);
  assert.equal(await runtime.equipmentAction(session, "p", "swiftyCancel", actor, bridge), false);
});
await test("Hardened Circuitry never protects from Black ICE deck effects", () => {
  const { actor } = fixture("Cyberdeck", ["Hardened Circuitry"]);
  assert.equal(runtime.equipmentProtection(actor, "disableDeck", { sourceKind: "blackice" }), false);
  assert.equal(runtime.equipmentProtection(actor, "disableDeck", { sourceKind: "program" }), true);
});
await test("CyberConductor defeats source-deck programs without healing them", async () => {
  const { actor, session, bridge, items, deck } = fixture();
  items.set(deck.id, deck);
  const next = { id: "next", name: "Cyberdeck", type: "cyberdeck", system: { equipped: "owned", installedItems: { slots: 7, list: [] } } };
  items.set(next.id, next);
  items.set("conductor", { id: "conductor", name: "CyberConductor", type: "gear", system: { installedItems: { list: [deck.id, next.id] } } });
  actor.getEquippedCyberdeck = () => [...items.values()].find(i => i.type === "cyberdeck" && i.system.equipped === "equipped");
  actor.updateEmbeddedDocuments = async (_type, updates) => { for (const change of updates) items.get(change._id).system.equipped = change["system.equipped"]; };
  items.get("1").system.isRezzed = true;
  let hpDamage = 0;
  bridge.damageRunnerHp = async (_id, amount) => { hpDamage += amount; };
  bridge.getInterfaceRank = () => 1; bridge.netActionsMax = () => 2;
  const result = await runtime.equipmentAction(session, "p", "switch", actor, bridge, { deckId: "next" });
  assert.equal(result.ok, true); assert.equal(hpDamage, 3);
  assert.equal(items.get("1").system.rez.value, 0);
  assert.equal(items.get("1").system.isRezzed, true);
  assert.equal(session.defeated["p|1"], true);
  assert.equal(actor.getEquippedCyberdeck().id, "next");
});
await test("Renamed ICE keeps its explicit equipment program identity", () => {
  const { actor, session, items } = fixture("Cyberdeck", ["Bushido Accelerator"], ["Custom Samurai"]);
  items.get("1").flags = { "cyberpunk-red-netrunning-suite": { programKey: "killer" } };
  items.get("1").system.spd = 8;
  assert.equal(runtime.equipmentIceStats(session, "p", actor, items.get("1")).spd, 10);
});
await test("Backup cannot overfill the deck or partially restore copies", async () => {
  const { actor, session, bridge, items } = fixture("Cyberdeck", ["Backup Drive"], Array(6).fill("Armor"));
  await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge);
  session.destroyed["p|1"] = true;
  const result = await runtime.equipmentAction(session, "p", "restore", actor, bridge);
  assert.equal(result.error, "CRNS.Equipment.InvalidLoadout", JSON.stringify({ result, profile: runtime.profileFor(actor), backups: session.equipment.p.backups }));
  assert.equal(session.destroyed["p|1"], true);
  assert.equal(session.participants.p.meatActionTurn, undefined);
  assert.equal(items.get("1").system.isRezzed, false);
});
await test("Phoenix cannot repair programs destroyed before this run", async () => {
  const { actor, session, bridge } = fixture("Phoenix");
  session.destroyed["p|1"] = true;
  await runtime.onEquipmentJackIn(session, "p", actor, bridge);
  await runtime.onEquipmentJackOut(session, "p", actor, bridge, { safe: true });
  assert.equal(session.destroyed["p|1"], true);
});
await test("Backup preserves spent Armor use when restored during a later run", async () => {
  const { actor, session, bridge } = fixture("Cyberdeck", ["Backup Drive"]);
  session.participants.p.runUsedIds["1"] = true;
  await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge);
  session.destroyed["p|1"] = true;
  session.participants.p.runUsedIds = {};
  await runtime.onEquipmentJackIn(session, "p", actor, bridge);
  assert.equal((await runtime.equipmentAction(session, "p", "restore", actor, bridge)).ok, true);
  assert.equal(session.participants.p.runUsedIds["1"], true);
});
await test("Zero-REZ Armor never reduces brain damage when a defeated mirror is missing", async () => {
  const { actor, session, bridge, items } = fixture();
  items.get("1").system.isRezzed = true; items.get("1").system.rez.value = 0;
  assert.equal(await runtime.equipmentBrainDamage(session, "p", actor, 7, bridge), 7);
});
await test("Smithy updates explicit program identity as well as name and damage", async () => {
  const { actor, session, bridge, items } = fixture("Cyberdeck", ["Smithy"], ["Sword"]);
  items.get("1").flags = { "cyberpunk-red-netrunning-suite": { programKey: "sword" } };
  assert.equal((await runtime.equipmentAction(session, "p", "smithy", actor, bridge)).ok, true);
  assert.equal(equipment.equipmentProgramKey(items.get("1")), "banhammer");
  assert.equal(items.get("1").system.damage.standard, "3d6");
});
await test("Function Driver protects only its selected program and does not consume Snaketrap", async () => {
  const { actor, session, bridge, deck } = fixture("Cyberdeck", ["Function Driver", "Snaketrap"]);
  deck.flags = { "cyberpunk-red-netrunning-suite": { functionDriverProgramId: "1" } };
  assert.equal(await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge, { random: true }), false);
  assert.equal(session.equipment.p.snakeUsed, false);
  assert.equal(await runtime.beforeEquipmentDestroy(session, "p", "2", actor, bridge, { random: true }), false);
  assert.equal(session.equipment.p.snakeUsed, true);
  assert.equal(await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge, { sourceKind: "physical" }), true);
});
await test("Scout free Pathfinder expires after another action serial", async () => {
  const { actor, session, bridge } = fixture("Microtech Scout");
  session.participants.p.scoutActionSerial = 8;
  await runtime.onEquipmentJackIn(session, "p", actor, bridge);
  assert.equal((await runtime.equipmentAction(session, "p", "scout", actor, bridge)).ability, "pathfinder");
  assert.equal(await runtime.equipmentAction(session, "p", "scout", actor, bridge), false);
  await runtime.onEquipmentJackIn(session, "p", actor, bridge);
  session.participants.p.scoutActionSerial++;
  assert.equal(await runtime.equipmentAction(session, "p", "scout", actor, bridge), false);
});
await test("Cancelling Swifty rolls restores Scout serial only without intervening actions", async () => {
  const { actor, session, bridge } = fixture("Microtech Scout", ["Swifty Clean"]);
  await runtime.onEquipmentJackIn(session, "p", actor, bridge);
  await runtime.equipmentAction(session, "p", "swifty", actor, bridge);
  await runtime.equipmentAction(session, "p", "swiftyCancel", actor, bridge);
  assert.equal((await runtime.equipmentAction(session, "p", "scout", actor, bridge)).ok, true);
  await runtime.onEquipmentJackIn(session, "p", actor, bridge);
  await runtime.equipmentAction(session, "p", "swifty", actor, bridge);
  session.participants.p.scoutActionSerial++;
  await runtime.equipmentAction(session, "p", "swiftyCancel", actor, bridge);
  assert.equal(await runtime.equipmentAction(session, "p", "scout", actor, bridge), false);
});
await test("Smithy leaves destroyed tombstones unchanged", async () => {
  const { actor, session, bridge, items } = fixture("Cyberdeck", ["Smithy"], ["Sword", "Sword"]);
  session.destroyed["p|1"] = true;
  await runtime.equipmentAction(session, "p", "smithy", actor, bridge);
  assert.equal(items.get("1").name, "Sword");
  assert.equal(items.get("2").name, "Banhammer");
});
await test("Shared FBC Backup Drive IDs survive save and restoration", async () => {
  const { actor, session, bridge, deck, items } = fixture("Cyberdeck", [], ["Armor"]);
  items.set("arm", { id: "arm", name: "Cyberdeck Cyberarm Option", type: "cyberware", system: { isInstalledInActor: true, installedItems: { list: [deck.id] } } });
  items.set("coating", { id: "coating", name: "FBC Integrated Bodyweight Coating", type: "cyberware", system: { isInstalledInActor: true, installedItems: { list: ["backup"] } } });
  items.set("backup", { id: "backup", name: "Backup Drive", type: "itemUpgrade", system: { size: 2 } });
  await runtime.beforeEquipmentDestroy(session, "p", "1", actor, bridge);
  assert.equal(session.equipment.p.backups["1"].driveIds[0], "backup");
  session.destroyed["p|1"] = true;
  assert.equal((await runtime.equipmentAction(session, "p", "restore", actor, bridge)).ok, true);
});
console.log(`${count} authoritative equipment transition checks passed.`);
