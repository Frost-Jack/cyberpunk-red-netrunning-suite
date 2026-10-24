/* node tools/equipment-test.mjs; --i18n prints staging translations for integration.
 * Data URLs load the actual ES module sources without a package.json or Foundry. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const url = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const catalogURL = url(source("scripts/reference-catalog.js"));
const catalog = await import(catalogURL);
const rules = await import(url(source("scripts/rules-reference.js")));
const equipmentSource = source("scripts/equipment.js");
assert.ok(!/from\s+["'][^"']*(?:data|constants|cpr-bridge)\.js/.test(equipmentSource));
const equipment = await import(url(equipmentSource.replace('"./reference-catalog.js"', JSON.stringify(catalogURL))));
const { EQUIPMENT_CATALOG: entries, EQUIPMENT_BY_KEY: byKey, EQUIPMENT_LABELS: labels } = catalog;
const staging = Object.fromEntries(["en", "ru"].map((language) => [language, { Equipment: {
  ...labels[language], ...Object.fromEntries(entries.map((e) => [e.key, { name: e.name[language], effect: e.effect[language] }]))
} }]));
if (process.argv.includes("--i18n")) { console.log(JSON.stringify(staging, null, 2)); process.exit(0); }
assert.deepEqual(JSON.parse(source("tools/equipment-i18n.json")), staging);
const { equipmentProfile: profile, equipmentKey: key, equipmentProgramKey: pkey, installedEquipmentItems: installed,
  modifiedIceStats: ice, equipmentSlotCost: size, validateEquipmentLoadout: validate, equipmentEvent: event,
  equipmentRunState: runState, programSwapPlan: swap, equipmentProtection: protects,
  equipmentBrainDamage: damage, cyberConductorSwitchPlan: switchPlan } = equipment;
const ns = "cyberpunk-red-netrunning-suite";
let serial = 0;
const item = (name, type = "itemUpgrade", system = {}) => ({ id: `i${++serial}`, name, type, system });
const program = (name, cls = "attacker", extra = {}) => item(name, "program", { class: cls, ...extra });
function setup(deckKey, contents = [], loose = []) {
  const deck = item(byKey[deckKey]?.name.en ?? deckKey, "cyberdeck", { installedItems: { list: contents.map((i) => i.id) } });
  const actor = { items: new Map([...contents, ...loose, deck].map((i) => [i.id, i])) };
  actor.getOwnedItem = (id) => actor.items.get(id);
  deck.getInstalledItems = (type = false) => deck.system.installedItems.list.map(actor.getOwnedItem).filter((i) => i && (!type || i.type === type));
  return { actor, deck, profile: profile(actor, deck) };
}

assert.equal(entries.length, new Set(entries.map((e) => e.key)).size);
for (const [group, count] of Object.entries({ coreDecks: 3, coreHardware: 6, midnightDecks: 15, midnightHardware: 11, accessories: 11, specialDemons: 1 })) {
  assert.equal(entries.filter((e) => e.group === group).length, count, group);
}
for (const entry of entries) {
  assert.ok(entry.source.pages.length && entry.source.pages.every((p) => p > 0), entry.key);
  for (const language of ["en", "ru"]) {
    assert.ok(entry.name[language] && entry.effect[language], entry.key);
    assert.equal(key(entry.name[language]), entry.key);
    assert.ok(equipment.equipmentHint(entry.name[language], language).includes(entry.source.book));
    assert.equal(catalog.equipmentText(entry.key, "effect", language, (k) => k), entry.effect[language]);
  }
  for (const alias of entry.aliases) assert.equal(key(alias), entry.key);
  if (entry.kind === "hardware") {
    const hw = item(entry.name.en);
    const f = setup("excellentCyberdeck", [hw]);
    assert.ok(f.profile.keys.includes(entry.key));
    assert.equal(size(hw, f.profile), entry.rules.size);
    assert.ok(!setup("excellentCyberdeck", [], [hw]).profile.keys.includes(entry.key), "loose hardware grants no effect");
  }
  if (entry.kind === "deck") {
    const f = setup(entry.key);
    assert.equal(f.profile.deckKey, entry.key);
    assert.equal(validate(f.actor, f.deck).valid, true);
  }
}
assert.equal(key("SGI Technologies Warlock’s Book"), "warlocksBook");
assert.equal(key("  УСКОРИТЕЛЬ  БУСИДО "), "bushidoAccelerator");
const renamed = item("Личная дека", "cyberdeck"); renamed.flags = { [ns]: { equipmentKey: "hummingbird" } };
assert.equal(profile(null, renamed).extraNetActions, 1);
renamed.flags[ns].equipmentKey = "notAKnownKey";
assert.equal(key(renamed), null);
assert.equal(pkey("Speedy Gonzalves"), "speedyGonzalves");
assert.equal(pkey("Быстрый Гонзалвес"), "speedyGonzalves");
const customArmor = program("Armor", "defender");
customArmor.flags = { [ns]: { customContent: { id: "custom-armor", kind: "program" } } };
assert.equal(pkey(customArmor), "custom:custom-armor");
const customHardware = item("Insulated Wiring");
customHardware.flags = { [ns]: { customContent: { id: "custom-wire", kind: "hardware" } } };
assert.equal(key(customHardware), null);
customHardware.flags[ns].equipmentKey = "insulatedWiring";
assert.equal(key(customHardware), "insulatedWiring");
const customIce = program("Skunk", "blackice", { size: 5 });
customIce.flags = { [ns]: { customContent: { id: "custom-skunk", kind: "program" } } };
assert.equal(size(customIce, profile(null, null)), 5, "custom ICE uses its declared native size");
customIce.system.size = 0;
assert.equal(size(customIce, profile(null, null)), 0, "zero-size custom content remains zero-size");

const driverProgram = program("Sword", "antiprogramattacker", { size: 1 });
const driverSetup = setup("cyberdeck", [driverProgram, item("Function Driver")]);
driverSetup.deck.flags = { [ns]: { functionDriverProgramId: driverProgram.id } };
const driverProfile = profile(driverSetup.actor, driverSetup.deck);
assert.equal(size(driverProgram, driverProfile), 0);
assert.equal(size(program("Sword"), driverProfile), 1, "only the selected copy gets a free slot");
const slideProgram = program("Worm", "booster", { isRezzed: true, rez: { value: 7 } });
slideProgram.flags = { [ns]: { upgradeKey: "superSlide" } };
const slideSetup = setup("cyberdeck", [slideProgram]);
assert.equal(profile(slideSetup.actor, slideSetup.deck).slideAttempts, 2);
slideProgram.system.rez.value = 0;
assert.equal(profile(slideSetup.actor, slideSetup.deck).slideAttempts, 1);
const insulationSetup = setup("cyberdeck");
const insulatedSuit = item("Custom Armor", "armor", { equipped: "equipped" });
insulatedSuit.flags = { [ns]: { upgradeKey: "netsuitInsulation" } };
insulationSetup.actor.items.set(insulatedSuit.id, insulatedSuit);
assert.equal(profile(insulationSetup.actor, insulationSetup.deck).insulatedWiring, true);
insulatedSuit.system.equipped = "owned";
assert.equal(profile(insulationSetup.actor, insulationSetup.deck).insulatedWiring, false);
const coatingHardware = item("Insulated Wiring");
const coatingSetup = setup("cyberdeck");
const cyberarm = item("Cyberdeck Cyberarm Option", "cyberware", { isInstalledInActor: true, installedItems: { list: [coatingSetup.deck.id] } });
const coating = item("FBC Integrated Bodyweight Coating", "cyberware", { isInstalledInActor: true, installedItems: { list: [coatingHardware.id] } });
for (const added of [cyberarm, coating, coatingHardware]) coatingSetup.actor.items.set(added.id, added);
const coatingProfile = profile(coatingSetup.actor, coatingSetup.deck);
assert.equal(coatingProfile.insulatedWiring, true);
assert.equal(coatingProfile.sharedHardwareCapacity, 2);
assert.equal(validate(coatingSetup.actor, coatingSetup.deck).usage.sharedHardware, 1);
assert.equal(validate(coatingSetup.actor, coatingSetup.deck).usage.hardware, 0);
const secondCoatingHardware = item("KRASH Barrier");
coating.system.installedItems.list.push(secondCoatingHardware.id); coatingSetup.actor.items.set(secondCoatingHardware.id, secondCoatingHardware);
assert.equal(validate(coatingSetup.actor, coatingSetup.deck).valid, false, "coating has a separate finite pool");

const allHardware = entries.filter((e) => e.kind === "hardware").map((e) => item(e.name.en));
const full = setup("phoenix", [...allHardware, item("Bushido Accelerator")]);
const p = full.profile;
for (const name of ["backupDrive", "snaketrap", "defenseSequencer", "combatRecorder", "swiftyClean", "smithy", "phoenix", "insulatedWiring", "krashBarrier", "hardenedCircuitry", "swampMist", "felineInstinct", "hangryHangryDragon", "aerie"]) assert.equal(p[name], true, name);
assert.equal(p.bushidoAccelerators, 2);
assert.equal(p.backupDriveIds.length, 1);
assert.ok(p.installedHardwareIds.length > p.backupDriveIds.length);
assert.equal(p.range, 8);
assert.equal(p.dnaLockDV, 17);
const empty = profile(null, null);
for (const name of ["extraNetActions", "freeSpeedy", "bushidoAccelerators"]) assert.equal(empty[name], 0);
for (const name of ["safeJackout", "backupDrive", "snaketrap", "defenseSequencer", "combatRecorder", "swiftyClean", "smithy", "freePathfinder", "freeArmor", "phoenix", "insulatedWiring", "krashBarrier", "hardenedCircuitry", "swampMist", "felineInstinct", "hangryHangryDragon", "aerie"]) assert.equal(empty[name], false, name);
assert.equal(empty.brainDamageMultiplier, 1);
assert.equal(setup("kiramaTraining").profile.range, 2);
assert.equal(setup("kiramaTraining", [item("Range Upgrade")]).profile.rangeRequiresGM, true);
assert.equal(setup("cyberdeck", [item("Range Upgrade")]).profile.rangeRequiresGM, false);
assert.equal(setup("cyberdeck", [item("Crunch Whistle")]).profile.crunchWhistle, true);
assert.equal(setup("kiramaTraining").profile.brainDamageMultiplier, 2);
assert.equal(setup("microMate").profile.brainDamageMultiplier, 2);
assert.equal(setup("kiramaAdvanced").profile.safeJackout, true);
assert.equal(setup("kiramaEntry").profile.safeJackout, true);
assert.equal(setup("microtechScout").profile.freePathfinder, true);
assert.equal(setup("microtechWarrior").profile.freeArmor, true);
assert.equal(setup("kestrel2").profile.freeSpeedy, 2);
assert.equal(setup("hummingbird").profile.extraNetActions, 1);
const serialized = JSON.stringify([...full.actor.items.values()]);
profile(full.actor, full.deck); profile(full.actor, full.deck);
assert.equal(JSON.stringify([...full.actor.items.values()]), serialized);
const stray = item("Backup Drive");
full.actor.items.set(stray.id, stray);
const originalAPI = full.deck.getInstalledItems;
full.deck.getInstalledItems = () => [...originalAPI(), stray];
assert.ok(!installed(full.actor, full.deck).includes(stray), "even API results must belong to authoritative list");
full.deck.getInstalledItems = originalAPI;
const snapshotDeck = { ...full.deck }; delete snapshotDeck.getInstalledItems;
assert.deepEqual(profile(full.actor, snapshotDeck), p);
const second = item("Raven Microcyb Hummingbird", "cyberdeck", { installedItems: { list: [] } });
full.actor.items.set(second.id, second);
assert.equal(profile(full.actor, second).backupDrive, false, "other deck hardware must not leak");

const base = Object.freeze({ key: "killer", spd: 8, rez: 20 });
assert.equal(ice(base, p).spd, 12); assert.equal(base.spd, 8);
assert.equal(ice({ key: "wisp" }, p).damageDice, 2);
assert.equal(ice({ key: "wisp" }, empty).damageDice, 1);
assert.equal(ice({ key: "sabertooth" }, p, { kills: 3 }).damageDice, 9);
assert.equal(ice({ key: "sabertooth" }, empty, { kills: 3 }).damageDice, 6);
assert.equal(ice({ key: "dragon" }, p).restoreRezOnKill, true);
assert.equal(ice({ key: "raven" }, p).destroysDefender, true);
assert.equal(ice({ key: "raven" }, empty).destroysDefender, false);
assert.equal(ice({ key: "sabertooth" }, p, { kills: 2 }).damageFormula, "8d6");
assert.equal(damage(10, setup("microMate").profile, { armorReduction: 4 }), 12);
assert.equal(damage(2, p, { armorReduction: 4 }), 0);
for (const kind of ["program", "blackice"]) {
  assert.equal(protects(p, "ignite", { sourceKind: kind }), true);
  assert.equal(protects(p, "forceJackOut", { sourceKind: kind }), true);
}
assert.equal(protects(p, "destroyDeck", { sourceKind: "blackice" }), false);
assert.equal(protects(p, "emp", { sourceKind: "emp" }), true);
assert.equal(protects(p, "forceJackOut", { sourceKind: "physical" }), false);

function checkLoadout(deckKey, contents, valid) {
  const f = setup(deckKey, contents); assert.equal(validate(f.actor, f.deck).valid, valid, `${deckKey}: ${JSON.stringify(validate(f.actor, f.deck))}`);
}
checkLoadout("kiramaEntry", [program("Sword"), program("Banhammer")], false);
const mixedAttackers = setup("kiramaEntry", [program("Hellbolt", "antipersonnelattacker"), program("Sword", "antiprogramattacker")]);
assert.deepEqual(validate(mixedAttackers.actor, mixedAttackers.deck).errors.filter((e) => e.code === "onePerClass"),
  [{ code: "onePerClass", key: "attacker", count: 2 }], "Kirama Entry counts both native Attacker types together");
checkLoadout("kiramaEntry", [program("Sword", "antiprogramattacker"), program("Armor", "defender"), program("Speedy Gonzalves", "booster"), program("Killer", "blackice")], true);
checkLoadout("kiramaEntry", [program("Sword"), program("Armor", "defender"), program("Speedy Gonzalves", "booster"), program("Killer", "blackice")], true);
checkLoadout("kiramaTraining", [item("Smithy")], false);
checkLoadout("hummingbird", [program("Sword")], false);
checkLoadout("microtechAssault", [program("Sword")], false);
checkLoadout("microtechAssault", [program("Killer", "blackice"), program("Dragon", "blackice"), item("Bushido Accelerator"), item("Backup Drive")], true);
checkLoadout("microtechAssault", [program("Killer", "blackice"), program("Dragon", "blackice"), program("Wisp", "blackice")], false);
checkLoadout("kerberos", [program("Killer", "blackice")], false);
checkLoadout("kerberos", [program("Hellhound", "blackice")], true);
checkLoadout("verdantKnight", [program("Sword"), program("Shield", "defender")], true);
checkLoadout("verdantKnight", [program("Armor", "defender")], false);
checkLoadout("warlocksBook", [program("Sword")], false);
for (const cls of ["antipersonnelattacker", "antiprogramattacker"]) {
  checkLoadout("warlocksBook", [program("Sword", cls)], false);
  checkLoadout("microMate", [program("Sword", cls)], true);
}
checkLoadout("microMate", [program("Armor", "defender")], false);
checkLoadout("kaliya", [program("Shield", "defender")], false);
checkLoadout("kaliya", [program("Killer", "blackice")], false);
checkLoadout("kaliya", [...Array.from({ length: 3 }, () => program("Flak", "defender")), ...Array.from({ length: 6 }, () => program("Sword"))], true);
checkLoadout("kaliya", Array.from({ length: 7 }, () => program("Sword")), false);
checkLoadout("parraline6000", Array.from({ length: 4 }, () => program("Sword")), false);
checkLoadout("excellentCyberdeck", [item("Swamp Mist"), program("Killer", "blackice")], false);
checkLoadout("excellentCyberdeck", [item("Perfume Shoppe"), ...Array.from({ length: 7 }, () => program("Skunk", "blackice"))], true);
checkLoadout("excellentCyberdeck", [item("Perfume Shoppe"), ...Array.from({ length: 8 }, () => program("Skunk", "blackice"))], false);

const sword = program("Sword"), hammer = program("Banhammer");
assert.deepEqual(swap(p, { jackIn: true, programs: [sword, hammer] }).conversions.map((c) => c.to), ["banhammer", "sword"]);
assert.equal(swap(p, { inCombat: true, programs: [sword] }).meatActions, 1);
assert.equal(swap(empty, { inCombat: true, remove: [sword] }).allowed, false);
assert.equal(swap(empty, { remove: [sword], install: [hammer] }).seconds, 7200);
assert.equal(swap({ ...p, slotConstraints: { programs: ["sword", "shield"] } }, { programs: [sword] }).allowed, false);
const nativeSword = program("Sword", "antiprogramattacker");
assert.equal(swap({ ...p, slotConstraints: { classes: ["antiprogramattacker"] } }, { programs: [nativeSword] }).allowed, true,
  "Smithy accepts native CPR Attacker restrictions");
assert.equal(swap({ ...p, slotConstraints: { classes: ["defender", "booster"] } }, { programs: [nativeSword] }).allowed, false);

const armor = { id: "armor", key: "armor", class: "defender", size: 1, usedThisRun: true, oncePerRunSpent: true };
let state = event(p, runState(), { type: "jackIn", runId: "run1" }).state;
const originalState = JSON.stringify(state);
let step = event(p, state, { type: "programDestroyed", program: armor, random: true, sourceKind: "blackice", wasActive: true, eventId: "snake" });
assert.equal(step.effects[0].type, "preventDestroy"); assert.equal(step.state.backupPrograms.length, 0);
assert.equal(JSON.stringify(state), originalState, "state input must not mutate");
assert.equal(event(p, step.state, { type: "programDestroyed", program: armor, random: true, sourceKind: "blackice", eventId: "snake" }).effects.length, 0);
state = step.state;
step = event(p, state, { type: "programDestroyed", program: armor, random: true, sourceKind: "blackice", wasActive: true });
assert.equal(step.state.backupPrograms.length, 1); assert.equal(step.state.pendingArmor, true);
state = step.state;
assert.equal(event(p, state, { type: "backupRestore", availableSlots: 0 }).effects[0].type, "deny");
step = event(p, state, { type: "backupRestore", availableSlots: 1 });
assert.deepEqual(step.effects[0].programs[0], armor); assert.equal(step.effects[0].preservesUsage, true);
assert.equal(step.state.backupPrograms.length, 0); assert.equal(step.state.destroyedPrograms.length, 0);
assert.equal(event(p, state, { type: "backupRemoved" }).state.backupPrograms.length, 0);
assert.equal(event(p, state, { type: "unsafeJackout" }).effects.length, 0, "Phoenix never restores on unsafe exit");
step = event(p, state, { type: "safeJackout" }); assert.equal(step.effects[0].type, "restorePrograms");
assert.equal(step.state.backupPrograms.length, 0, "Phoenix must not duplicate backups");
assert.equal(event({ ...p, safeJackout: true }, state, { type: "unsafeJackout" }).effects.length, 2);
assert.equal(event(p, state, { type: "jackIn", runId: "run2" }).state.backupPrograms.length, 1, "backups survive runs");
const normal = event(p, event(p, null, { type: "jackIn" }).state,
  { type: "programDestroyed", program: { id: "ice", key: "killer", class: "blackice" }, random: false, sourceKind: "program" });
assert.equal(normal.state.snaketrapUsed, false); assert.equal(normal.state.backupPrograms.length, 0);
for (const cls of ["antipersonnelattacker", "antiprogramattacker"]) {
  const savedAttacker = event(p, state, { type: "programDestroyed", program: { id: cls, key: "sword", class: cls }, random: false, sourceKind: "program" });
  assert.ok(savedAttacker.state.backupProgramIds.includes(cls), "Backup Drive saves native Attacker classes");
}
step = event(p, state, { type: "turnStart", programs: [armor, { id: "unusedArmor", key: "armor", class: "defender" }] });
assert.equal(step.effects[0].programId, "unusedArmor"); assert.equal(step.state.pendingArmor, false);
assert.equal(event(p, step.state, { type: "turnStart", programs: [] }).effects.length, 0);
step = event(p, state, { type: "cloak", totals: [12, 19] }); assert.equal(step.effects[0].total, 19);
assert.equal(event(p, step.state, { type: "cloak" }).effects[0].type, "deny");
step = event(p, state, { type: "iceKill", iceId: "cat1", iceKey: "sabertooth" });
assert.equal(step.state.killsByIce.cat1, 1); assert.equal(step.state.killsByIce.cat2, undefined);
assert.equal(event(p, state, { type: "iceKill", iceId: "dragon", iceKey: "dragon", maxRez: 30 }).effects[0].rez, 30);
const dead = { type: "deathSave", failed: true, otherNetrunner: true, sameArchitecture: true, eventId: "death" };
step = event(p, state, dead); assert.equal(step.effects[0].value, 50); assert.equal(step.effects[0].minutes, 5);
assert.equal(event(p, step.state, dead).effects.length, 0);
assert.equal(event(p, state, { ...dead, otherNetrunner: false }).effects.length, 0);
assert.equal(event(p, state, { ...dead, sameArchitecture: false }).effects.length, 0);
for (const [deckKey, effectType] of [["microtechScout", "freePathfinder"], ["microtechWarrior", "freeRez"], ["kestrel2", "freeRez"]]) {
  const f = setup(deckKey); const first = event(f.profile, null, { type: "jackIn", runId: "same" });
  assert.equal(first.effects[0].type, effectType);
  assert.equal(event(f.profile, first.state, { type: "jackIn", runId: "same" }).effects.length, 0);
}

const conductor = item("CyberConductor", "gear", { installedItems: { list: [full.deck.id, second.id] } });
full.actor.items.set(conductor.id, conductor);
assert.equal(profile(full.actor, second).backupDrive, false);
assert.equal(profile(full.actor, second).switchHpDamage, 3);
assert.equal(switchPlan(full.actor, full.deck, second).hpDamage, 3);
conductor.name = "CyberConductor, Integrated";
assert.equal(switchPlan(full.actor, full.deck, second).hpDamage, 0);
assert.equal(switchPlan(full.actor, full.deck, full.deck).allowed, false);
const armDeck = setup("kiramaTraining");
const hardwired = item("Cyberdeck (Hardwired)", "cyberware", { installedItems: { list: [armDeck.deck.id] } });
const upgrade = item("Integrated Cyberdeck Upgrade", "cyberware");
const arm = item("Cyberarm", "cyberware", { type: "cyberArm", installedItems: { list: [hardwired.id, upgrade.id] } });
for (const i of [hardwired, upgrade, arm]) armDeck.actor.items.set(i.id, i);
assert.equal(profile(armDeck.actor, armDeck.deck).extraSharedSlots, 2);
arm.system.installedItems.list = [hardwired.id];
assert.equal(profile(armDeck.actor, armDeck.deck).extraSharedSlots, 1, "upgrade in loose inventory/other arm grants nothing");
assert.equal(byKey.rockLobster.rules.anyNetAction, true); assert.equal(byKey.rockLobster.rules.autoSpawn, false);
assert.equal(byKey.rockLobster.rules.baseDemon, "balron");

// Execute the actual help view model with only its Foundry-facing dependencies
// replaced; equipment/catalog bodies above are unmodified production modules.
const helpSource = source("scripts/apps/help.js").replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "");
const viewGame = { user: { isGM: true }, i18n: { lang: "ru" } };
let viewer = full.actor;
const helpDeps = { ...catalog, ...equipment, ...rules, BLACK_ICE: {}, DEMONS: {}, PROGRAM_INFO: {}, ENTITY_ICONS: {},
  programIcon: (_name, fallback) => fallback || "icons/svg/circuit.svg",
  abbrFor: (k) => k, loc: (k) => k, getWorld: () => ({}), visibleFloorIds: () => new Set(),
  getDeck: () => full.deck, installedPrograms: () => [], userNetrunnerActor: () => viewer };
const help = new Function("deps", "game", `const {${Object.keys(helpDeps).join(",")}}=deps;${helpSource};return {getData};`)(helpDeps, viewGame);
let reference = help.getData({ state: {} }).help;
assert.equal(reference.demons.length, 3, "standard demon list stays unchanged");
assert.equal(reference.equipmentGroups.flatMap((g) => g.entries).length, entries.length);
assert.ok(reference.equipmentGroups.flatMap((g) => g.entries).find((e) => e.key === "backupDrive").framed);
assert.equal(reference.equipmentGroups.find((g) => g.key === "specialDemons").entries[0].framed, false);
assert.equal(reference.equipmentTitle, labels.ru.Title);
assert.ok(reference.equipmentGroups[0].entries[0].tooltip.includes("с. 196"));
viewer = null;
reference = help.getData({ state: {} }).help;
// getDeck is never called for absent viewers, so no inventory framing leaks.
assert.equal(reference.equipmentGroups.flatMap((g) => g.entries).some((e) => e.framed), false);
const template = source("templates/help.hbs");
assert.ok(template.includes('data-net-tooltip="{{e.tooltip}}"'));
assert.ok(template.includes('title="{{e.tooltip}}"'));
for (const block of ["if", "each"]) {
  assert.equal((template.match(new RegExp(`{{#${block}\\b`, "g")) ?? []).length,
    (template.match(new RegExp(`{{/${block}}}`, "g")) ?? []).length);
}
console.log(`Equipment: ${entries.length} bilingual entries; profile, container isolation, slots, ICE, swapping, run-state and help checks passed.`);
