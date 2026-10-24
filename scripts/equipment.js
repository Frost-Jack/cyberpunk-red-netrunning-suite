/* Pure equipment rules. No data.js, Foundry globals, document writes or hooks.
 * The caller supplies the currently USED deck (normally getEquippedCyberdeck()).
 * Presence booleans are capabilities, not remaining uses. Persist run state only
 * from explicit actions. CPR Container.getInstalledItems() resolves IDs from
 * system.installedItems.list; loose inventory and other decks never grant hardware.
 */
import { EQUIPMENT_CATALOG, EQUIPMENT_BY_KEY, equipmentText, equipmentSource } from "./reference-catalog.js";

const MODULE_ID = "cyberpunk-red-netrunning-suite";
export const normalizeEquipmentName = (name) => String(name ?? "").normalize("NFKC")
  .toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
const names = new Map(EQUIPMENT_CATALOG.flatMap((e) => [e.key, e.name.en, e.name.ru, ...e.aliases]
  .map((name) => [normalizeEquipmentName(name), e.key])));

/** Explicit flags[MODULE_ID].equipmentKey wins over renamed/localized names. */
export function equipmentKey(item) {
  if (typeof item === "string") return names.get(normalizeEquipmentName(item)) ?? null;
  const flagged = item?.flags?.[MODULE_ID]?.equipmentKey;
  if (flagged) return EQUIPMENT_BY_KEY[flagged] ? flagged : null;
  if (item?.flags?.[MODULE_ID]?.customContent) return null;
  return names.get(normalizeEquipmentName(item?.name)) ?? null;
}

const itemId = (item) => item?.id ?? item?._id;
const actorItems = (actor) => Array.from(actor?.items?.contents ?? actor?.items?.values?.() ?? actor?.items ?? []);

/** Mirrors CPR's container mixin, with a plain-data fallback for tests/snapshots. */
export function installedEquipmentItems(actor, deck) {
  if (!deck) return [];
  const ids = deck.system?.installedItems?.list;
  const items = typeof deck.getInstalledItems === "function" ? deck.getInstalledItems()
    : (ids ?? []).map((id) => actor?.getOwnedItem?.(id) ?? actor?.items?.get?.(id)
      ?? actorItems(actor).find((i) => itemId(i) === id));
  return [...new Map(items.filter((i) => i && (!Array.isArray(ids) || ids.includes(itemId(i))))
    .map((i) => [itemId(i), i])).values()];
}

const PROGRAM_NAMES = {
  armor: ["Доспехи", "Броня"], sword: ["Меч"], shield: ["Щит"], banhammer: ["Банхаммер", "Бан-молот"],
  flak: ["Фейерверк"], hellhound: ["Адская гончая"], asp: ["Аспид"], skunk: ["Скунс"],
  wisp: ["Дух", "Блуждающий огонёк"], killer: ["Убийца"], sabertooth: ["Саблезуб"],
  dragon: ["Дракон"], raven: ["Ворон"], speedyGonzalves: ["Speedy Gonzalvez", "Speedy Gonzales", "Быстрый Гонзалвес"]
};
const programNames = new Map(Object.entries(PROGRAM_NAMES).flatMap(([key, aliases]) =>
  [key, ...aliases].map((name) => [normalizeEquipmentName(name), key])));
export function equipmentProgramKey(program) {
  const explicit = program?.key ?? program?.flags?.[MODULE_ID]?.programKey;
  const custom = program?.flags?.[MODULE_ID]?.customContent;
  if (!explicit && custom) return `custom:${custom.id}`;
  return programNames.get(normalizeEquipmentName(explicit ?? program?.name ?? program))
    ?? normalizeEquipmentName(explicit ?? program?.name ?? program);
}
// CPR splits Attacker by target; equipment rules use the shared Attacker class.
const equipmentClass = (value) => {
  const cls = normalizeEquipmentName(value);
  return ["antipersonnelattacker", "antiprogramattacker"].includes(cls) ? "attacker" : cls;
};
const programClass = (program) => equipmentClass(program?.class ?? program?.system?.class);

/** All profile fields are always present. No profile read consumes a capability. */
export function equipmentProfile(actor, deck) {
  const installed = installedEquipmentItems(actor, deck);
  const all = actorItems(actor);
  const ancestors = [];
  const visited = new Set([itemId(deck)]);
  let child = deck;
  while (child) {
    const parent = all.find((i) => !visited.has(itemId(i)) && i.system?.installedItems?.list?.includes(itemId(child)));
    if (!parent) break;
    visited.add(itemId(parent)); ancestors.push(parent); child = parent;
  }
  const cyberwareIntegrated = !!deck?.system?.isInstalledInActor || ancestors.some(i => i.type === "cyberware" && i.system?.isInstalledInActor);
  const coatings = cyberwareIntegrated ? all.filter(i => equipmentKey(i) === "fbcBodyweightCoating" && i.system?.isInstalledInActor) : [];
  const sharedHardware = [...new Map(coatings.flatMap(i => installedEquipmentItems(actor, i)).filter(i => i.type === "itemUpgrade").map(i => [itemId(i), i])).values()];
  const hardware = [...new Map([...installed, ...sharedHardware].filter((i) => i.type === "itemUpgrade").map(i => [itemId(i), i])).values()];
  let deckKey = equipmentKey(deck);
  // Stock CPR decks are often all named Cyberdeck; quality identifies their size.
  if (deckKey === "cyberdeck") {
    if (deck?.system?.quality === "poor") deckKey = "poorCyberdeck";
    if (deck?.system?.quality === "excellent") deckKey = "excellentCyberdeck";
  }
  if (EQUIPMENT_BY_KEY[deckKey]?.kind !== "deck") deckKey = null;
  const counts = {};
  for (const item of hardware) {
    const key = equipmentKey(item);
    if (["hardware", "upgrade"].includes(EQUIPMENT_BY_KEY[key]?.kind)) counts[key] = (counts[key] ?? 0) + 1;
  }
  const rules = EQUIPMENT_BY_KEY[deckKey]?.rules ?? {};
  const profile = {
    deckKey, keys: [...(deckKey ? [deckKey] : []), ...Object.keys(counts)], counts,
    installedHardwareIds: hardware.map(itemId), backupDriveIds: hardware.filter((i) => equipmentKey(i) === "backupDrive").map(itemId),
    installedProgramIds: installed.filter((i) => i.type === "program").map(itemId),
    sharedHardwareIds: sharedHardware.map(itemId), sharedHardwareCapacity: coatings.length * 2, requiresInterfacePlugs: coatings.length === 0,
    functionDriverProgramId: null, slideAttempts: 1,
    extraNetActions: rules.extraNetActions ?? 0, brainDamageMultiplier: rules.brainDamageMultiplier ?? 1,
    safeJackout: !!rules.safeJackout, insulatedWiring: !!counts.insulatedWiring,
    krashBarrier: !!counts.krashBarrier, hardenedCircuitry: !!counts.hardenedCircuitry,
    backupDrive: !!counts.backupDrive, snaketrap: !!counts.snaketrap,
    defenseSequencer: !!counts.defenseSequencer, combatRecorder: !!counts.combatRecorder,
    swiftyClean: !!counts.swiftyClean, smithy: !!counts.smithy,
    freePathfinder: !!rules.freePathfinder, freeArmor: !!rules.freeArmor,
    freeSpeedy: rules.freeSpeedy ?? 0, phoenix: !!rules.phoenix,
    bushidoAccelerators: counts.bushidoAccelerator ?? 0, swampMist: !!counts.swampMist,
    felineInstinct: !!counts.felineInstinct, hangryHangryDragon: !!counts.hangryHangryDragon,
    aerie: !!counts.aerie, perfumeShoppe: !!counts.perfumeShoppe,
    range: counts.rangeUpgrade ? 8 : (rules.range ?? 6), rangeRequiresGM: deckKey === "kiramaTraining" && !!counts.rangeUpgrade, damageReduction: 0,
    crunchWhistle: !!counts.crunchWhistle,
    dnaLockDV: counts.dnaLock ? 17 : 0,
    slotConstraints: { ...rules, classes: rules.classes ? [...rules.classes] : undefined,
      programs: rules.programs ? [...rules.programs] : undefined,
      slots: { ...(rules.slots ?? { shared: Number(deck?.system?.installedItems?.slots ?? 0) }) } },
    accessoryKeys: [], extraHardwareSlots: 0, extraSharedSlots: 0,
    cyberConductor: false, integratedCyberConductor: false, switchHpDamage: 0, switchMeatActions: 1,
    switchDerezzesAll: true, shareHardwareBetweenDecks: false
  };
  if (!deck) return profile;
  // Only actual ancestors of this deck and equipped armor grant mount bonuses.
  const worn = all.filter((i) => ["lotosNetsuit", "bodyweightSuit"].includes(equipmentKey(i)) && i.system?.equipped === "equipped");
  const related = [...new Map([...ancestors, ...worn].map((i) => [itemId(i), i])).values()];
  // Integrated CyberConductor also connects cyberware decks outside its own
  // container. CPR's getter confirms these are installed, not loose cyberware.
  if (deck.system?.isInstalledInActor || ancestors.some((i) => i.type === "cyberware" && i.system?.isInstalledInActor)) {
    related.push(...all.filter((i) => equipmentKey(i) === "integratedCyberConductor" && i.system?.isInstalledInActor));
  }
  const arm = ancestors.find((i) => normalizeEquipmentName(i.system?.type) === "cyberarm"
    || ["cyberarm", "киберрука"].includes(normalizeEquipmentName(i.name)));
  if (arm && ancestors.some((i) => equipmentKey(i) === "cyberdeckCyberarmOption")) {
    related.push(...installedEquipmentItems(actor, arm).filter((i) => equipmentKey(i) === "integratedCyberdeckUpgrade"));
  }
  for (const item of related) {
    const key = equipmentKey(item);
    const rule = EQUIPMENT_BY_KEY[key]?.rules;
    if (!rule || profile.accessoryKeys.includes(key)) continue;
    profile.accessoryKeys.push(key);
    if (!(key === "bodyweightSuit" && coatings.length)) profile.extraHardwareSlots += rule.hardwareSlots ?? 0;
    profile.extraSharedSlots += rule.sharedSlots ?? 0;
    if (key === "cyberConductor" || key === "integratedCyberConductor") {
      profile.cyberConductor = true;
      profile.integratedCyberConductor = key === "integratedCyberConductor";
      profile.switchHpDamage = rule.switchHpDamage;
    }
  }
  if (coatings.length) profile.accessoryKeys.push("fbcBodyweightCoating");
  if (all.filter(i => i.type === "armor" && i.system?.equipped === "equipped").some(suit => installedEquipmentItems(actor, suit).some(i => equipmentKey(i) === "netsuitInsulation")
    || suit.flags?.[MODULE_ID]?.upgradeKey === "netsuitInsulation")) {
    profile.insulatedWiring = true; profile.accessoryKeys.push("netsuitInsulation");
  }
  const driverId = deck.flags?.[MODULE_ID]?.functionDriverProgramId;
  if (counts.functionDriver || deck.flags?.[MODULE_ID]?.upgradeKey === "functionDriver") {
    const selected = installed.find(i => i.type === "program" && itemId(i) === driverId && programClass(i) !== "blackice"
      && Number(i.system?.size ?? 1) === 1);
    if (selected) profile.functionDriverProgramId = itemId(selected);
    profile.accessoryKeys.push("functionDriver");
  }
  if (installed.some(p => p.type === "program" && ["speedyGonzalves", "worm"].includes(equipmentProgramKey(p))
    && p.flags?.[MODULE_ID]?.upgradeKey === "superSlide" && p.system?.isRezzed && Number(p.system?.rez?.value) > 0)) {
    profile.slideAttempts = 2; profile.accessoryKeys.push("superSlide");
  }
  profile.keys.push(...profile.accessoryKeys);
  return profile;
}

/** Base stats use flat per/spd/atk/def/rez, key; rez can also be {value,max}.
 * kills counts ONLY kills by this individual ICE, not kills by other copies.
 * Always pass original base stats, never an already-modified result. */
export function modifiedIceStats(base, profile, { kills = 0 } = {}) {
  const key = equipmentProgramKey(base);
  const out = { ...base, rez: typeof base.rez === "object" ? { ...base.rez } : base.rez,
    damageDice: base.damageDice ?? ({ wisp: 1, raven: 1, killer: 4, sabertooth: 6, dragon: 6 }[key] ?? 0),
    destroysPrograms: !!base.destroysPrograms || ["killer", "sabertooth", "dragon"].includes(key),
    destroysDefender: !!base.destroysDefender, restoreRezOnKill: false };
  if (key === "killer") out.spd = Number(base.spd ?? 0) + 2 * (profile.bushidoAccelerators ?? 0);
  if (key === "wisp" && profile.swampMist) out.damageDice = 2;
  if (key === "sabertooth" && profile.felineInstinct) out.damageDice += Math.max(0, Number(kills) || 0);
  if (key === "dragon" && profile.hangryHangryDragon) out.restoreRezOnKill = true;
  if (key === "raven" && profile.aerie) out.destroysDefender = true;
  out.damageFormula = `${out.damageDice}d6`;
  return out;
}

/** Text-only tooltip, suitable for data-net-tooltip or title (escape in template). */
export function equipmentHint(item, language = "en", localize) {
  const key = equipmentKey(item);
  return key ? [equipmentText(key, "name", language, localize), equipmentText(key, "effect", language, localize), equipmentSource(key, language)].join("\n") : "";
}

function programRestriction(program, profile) {
  const key = equipmentProgramKey(program);
  const cls = programClass(program);
  const rules = profile.slotConstraints ?? {};
  if (rules.classes && !rules.classes.some((allowed) => equipmentClass(allowed) === cls)) return "programClass";
  if (rules.programs && !rules.programs.includes(key)) return "programName";
  if (rules.kaliya && ((cls === "defender" && key !== "flak") || (cls === "blackice" && key !== "asp"))) return "kaliya";
  if (profile.swampMist && cls === "blackice" && key !== "wisp") return "swampMist";
  return null;
}

/** Slot cost is canonical for known hardware/ICE, CPR system.size otherwise. */
export function equipmentSlotCost(item, profile) {
  if (item.type === "program" || (!item.type && (item.class || item.system?.class))) {
    if (itemId(item) && itemId(item) === profile.functionDriverProgramId) return 0;
    if (item.flags?.[MODULE_ID]?.customContent) return Math.max(0, Number(item.system?.size ?? item.size ?? 1));
    if (programClass(item) === "blackice") return profile.perfumeShoppe && equipmentProgramKey(item) === "skunk" ? 1 : 2;
    return Math.max(1, Number(item.system?.size ?? item.size ?? 1));
  }
  return EQUIPMENT_BY_KEY[equipmentKey(item)]?.rules?.size ?? Math.max(1, Number(item.system?.size ?? item.size ?? 1));
}

/** Validates the actual installed loadout, never loose inventory.
 * Additional slots keep deck Program restrictions. Separate Program/Hardware
 * pools are not interchangeable; Kaliya's reserved pool only accepts Flak. */
export function validateEquipmentLoadout(actor, deck, { excludedProgramIds = [] } = {}) {
  const profile = equipmentProfile(actor, deck);
  const errors = [];
  if (!deck) return { valid: false, errors: [{ code: "noDeck", key: null }] };
  const installed = installedEquipmentItems(actor, deck);
  const classes = {};
  let program = 0; let hardware = 0; let flak = 0;
  for (const item of installed) {
    if (item.type === "program" && excludedProgramIds.includes(itemId(item))) continue;
    const key = equipmentKey(item) ?? equipmentProgramKey(item);
    if (item.type === "program") {
      const cls = programClass(item);
      const restriction = programRestriction(item, profile);
      if (restriction) errors.push({ code: restriction, key, itemId: itemId(item) });
      classes[cls] = (classes[cls] ?? 0) + 1;
      const size = equipmentSlotCost(item, profile);
      program += size;
      if (equipmentProgramKey(item) === "flak") flak += size;
    } else if (item.type === "itemUpgrade" && !profile.sharedHardwareIds.includes(itemId(item))) hardware += equipmentSlotCost(item, profile);
    else errors.push({ code: "itemType", key, itemId: itemId(item) });
  }
  const sharedHardware = actorItems(actor).filter(i => profile.sharedHardwareIds.includes(itemId(i)));
  const sharedHardwareUsage = sharedHardware.reduce((sum, i) => sum + equipmentSlotCost(i, profile), 0);
  if (sharedHardwareUsage > profile.sharedHardwareCapacity) errors.push({ code: "slots", key: "fbcBodyweightCoating", hardware: sharedHardwareUsage, overflow: sharedHardwareUsage - profile.sharedHardwareCapacity });
  if (profile.slotConstraints.onePerClass) {
    for (const [key, count] of Object.entries(classes)) if (count > 1) errors.push({ code: "onePerClass", key, count });
  }
  const slots = { program: 0, hardware: 0, shared: 0, flak: 0, ...profile.slotConstraints.slots };
  slots.hardware += profile.extraHardwareSlots;
  slots.shared += profile.extraSharedSlots;
  const remainingProgram = Math.max(0, program - Math.min(flak, slots.flak) - slots.program);
  const remainingHardware = Math.max(0, hardware - slots.hardware);
  if (remainingProgram + remainingHardware > slots.shared) errors.push({ code: "slots", key: profile.deckKey,
    program, hardware, slots: { ...slots }, overflow: remainingProgram + remainingHardware - slots.shared });
  if (profile.accessoryKeys.includes("lotosNetsuit") && profile.accessoryKeys.includes("bodyweightSuit")) errors.push({ code: "incompatibleArmor", key: "lotosNetsuit" });
  return { valid: errors.length === 0, errors, usage: { program, hardware, sharedHardware: sharedHardwareUsage }, slots };
}

/** Smithy is NOT arbitrary hot-swapping. Pass ALL installed programs in programs
 * (or remove for the original contract). Returns simultaneous key conversions.
 * Ordinary install/uninstall requires an hour per program, outside combat/run. */
export function programSwapPlan(profile, { inCombat = false, jackIn = false, remove = [], install = [], programs = remove } = {}) {
  const result = { allowed: false, netActions: 0, meatActions: 0, reason: null, conversions: [], seconds: 0 };
  if (profile.smithy && install.length === 0) {
    result.conversions = programs.filter((p) => ["sword", "banhammer"].includes(equipmentProgramKey(p)))
      .map((p) => {
        const sword = equipmentProgramKey(p) === "banhammer";
        return { itemId: itemId(p), from: equipmentProgramKey(p), to: sword ? "sword" : "banhammer",
          atk: 1, damageStandard: sword ? "2d6" : "3d6", damageBlackIce: sword ? "3d6" : "2d6" };
      });
    if (!result.conversions.length) return { ...result, reason: "noSmithyPrograms" };
    if (result.conversions.some((p) => programRestriction({ key: p.to, class: "antiprogramattacker" }, profile))) return { ...result, reason: "programRestriction" };
    return { ...result, allowed: true, meatActions: 1 };
  }
  if (inCombat || jackIn) return { ...result, reason: "requiresDowntime" };
  if (install.some((p) => programRestriction(p, profile))) return { ...result, reason: "programRestriction" };
  return { ...result, allowed: true, seconds: 3600 * (remove.length + install.length) };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Serializable caller-owned state. backupPrograms retain exact plain snapshots,
 * including usedThisRun/once-per-run flags; never refresh them on restore.
 * eventId must be unique across the run (and across runs for persistent backups).
 * jackIn begins a NEW run, not a CyberConductor switch. */
export function equipmentRunState(saved = {}) {
  return { active: false, runId: null, backupUsed: false, backupProgramIds: [], backupPrograms: [],
    snaketrapUsed: false, swiftyCleanUsed: false, pendingArmor: false, usedArmorIds: [],
    destroyedPrograms: [], killsByIce: {}, processedEventIds: [], ...clone(saved) };
}

/** Pure action planner. Persist returned state and apply effects ONCE, atomically
 * in the authoritative runtime. events carry plain program snapshots, not Items.
 *
 * jackIn {runId}; programDestroyed {program:{id,key,class,size,...}, random,
 *   sourceKind:'program'|'blackice', wasActive}; armorDerezzed {wasActive};
 * programRezzed {program}; turnStart {programs:[{id,key,usedThisRun,...}]};
 * backupRestore {availableSlots}; backupRemoved; safeJackout/unsafeJackout;
 * cloak {totals?:number[]}; iceKill {iceId,iceKey,maxRez};
 * deathSave {failed,otherNetrunner,sameArchitecture}.
 *
 * Effects: preventDestroy, backupSaved, restorePrograms (snapshots, preservesUsage),
 * freePathfinder, freeRez (programKey,maxCount), rezArmor (programId), safeJackout,
 * cloakRoll (rolls,keep,netActions), cloakResult (total), deny (reason),
 * restoreIceRez (iceId,rez), recording (minutes,value,anonymized).
 * programDestroyed is a PRE-destruction event: preventDestroy cancels removal.
 */
export function equipmentEvent(profile, saved, event) {
  let state = equipmentRunState(saved);
  const effects = [];
  if (event.eventId && state.processedEventIds.includes(event.eventId)) return { state, effects };
  if (event.type === "jackIn") {
    if (state.active && event.runId && state.runId === event.runId) return { state, effects };
    state = equipmentRunState({ backupPrograms: state.backupPrograms, backupProgramIds: state.backupProgramIds,
      active: true, runId: event.runId ?? null });
    if (profile.freePathfinder) effects.push({ type: "freePathfinder", netActions: 0 });
    if (profile.freeArmor) effects.push({ type: "freeRez", programKey: "armor", maxCount: 1, netActions: 0 });
    if (profile.freeSpeedy) effects.push({ type: "freeRez", programKey: "speedyGonzalves", maxCount: profile.freeSpeedy, netActions: 0 });
  } else if (event.type === "programDestroyed" && state.active) {
    const program = event.program;
    if (!program || !itemId(program)) return { state, effects: [{ type: "deny", reason: "programSnapshotRequired" }] };
    if (profile.functionDriverProgramId === itemId(program) && ["program", "blackice"].includes(event.sourceKind)) {
      effects.push({ type: "preventDestroy", programId: itemId(program) });
    } else if (profile.snaketrap && !state.snaketrapUsed && event.random === true && ["program", "blackice"].includes(event.sourceKind)) {
      state.snaketrapUsed = true;
      effects.push({ type: "preventDestroy", programId: itemId(program) });
    } else {
      if (!state.destroyedPrograms.some((p) => itemId(p) === itemId(program))) state.destroyedPrograms.push(clone(program));
      if (profile.backupDrive && ["attacker", "defender", "booster"].includes(programClass(program))) {
        if (!state.backupProgramIds.includes(itemId(program))) {
          state.backupPrograms.push(clone(program)); state.backupProgramIds.push(itemId(program));
          effects.push({ type: "backupSaved", programId: itemId(program) });
        }
      }
      if (equipmentProgramKey(program) === "armor" && event.wasActive) {
        if (!state.usedArmorIds.includes(itemId(program))) state.usedArmorIds.push(itemId(program));
        if (profile.defenseSequencer) state.pendingArmor = true;
      }
    }
  } else if (event.type === "armorDerezzed" && state.active && profile.defenseSequencer && event.wasActive) {
    state.pendingArmor = true;
    if (event.program && !state.usedArmorIds.includes(itemId(event.program))) state.usedArmorIds.push(itemId(event.program));
  } else if (event.type === "programRezzed" && state.active && equipmentProgramKey(event.program) === "armor") {
    if (!state.usedArmorIds.includes(itemId(event.program))) state.usedArmorIds.push(itemId(event.program));
  } else if (event.type === "turnStart" && state.active && profile.defenseSequencer && state.pendingArmor) {
    const armor = (event.programs ?? []).find((p) => equipmentProgramKey(p) === "armor"
      && !p.usedThisRun && !p.destroyed && !p.defeated && !p.system?.isRezzed && !p.isRezzed && !state.usedArmorIds.includes(itemId(p)));
    state.pendingArmor = false;
    if (armor) {
      state.usedArmorIds.push(itemId(armor));
      effects.push({ type: "rezArmor", programId: itemId(armor), netActions: 0 });
    }
  } else if (event.type === "backupRestore" && profile.backupDrive && state.backupPrograms.length) {
    const required = state.backupPrograms.reduce((sum, p) => sum + equipmentSlotCost(p, profile), 0);
    if (!(event.availableSlots >= required)) effects.push({ type: "deny", reason: "backupSlots", required });
    else {
      effects.push({ type: "restorePrograms", programs: clone(state.backupPrograms), preservesUsage: true, meatActions: 1 });
      const restored = new Set(state.backupProgramIds);
      state.destroyedPrograms = state.destroyedPrograms.filter((p) => !restored.has(itemId(p)));
      state.backupUsed = true; state.backupPrograms = []; state.backupProgramIds = [];
    }
  } else if (event.type === "backupRemoved") {
    state.backupPrograms = []; state.backupProgramIds = [];
  } else if (["safeJackout", "unsafeJackout"].includes(event.type) && state.active) {
    const safe = event.type === "safeJackout" || profile.safeJackout;
    if (safe && event.type === "unsafeJackout") effects.push({ type: "safeJackout" });
    if (safe && profile.phoenix && state.destroyedPrograms.length) {
      effects.push({ type: "restorePrograms", programs: clone(state.destroyedPrograms), preservesUsage: true,
        restoreRez: "max", isRezzed: false, meatActions: 0 });
      const restored = new Set(state.destroyedPrograms.map(itemId));
      state.backupPrograms = state.backupPrograms.filter((p) => !restored.has(itemId(p)));
      state.backupProgramIds = state.backupPrograms.map(itemId);
      state.destroyedPrograms = [];
    }
    state.active = false; state.pendingArmor = false; state.killsByIce = {};
  } else if (event.type === "cloak" && state.active && profile.swiftyClean) {
    if (state.swiftyCleanUsed) effects.push({ type: "deny", reason: "cloakOncePerRun" });
    else {
      state.swiftyCleanUsed = true;
      effects.push(event.totals?.length === 2 ? { type: "cloakResult", total: Math.max(...event.totals), netActions: 1 }
        : { type: "cloakRoll", rolls: 2, keep: "highest", netActions: 1 });
    }
  } else if (event.type === "iceKill" && state.active) {
    const key = equipmentProgramKey(event.iceKey);
    if (key === "sabertooth" && profile.felineInstinct && event.iceId) state.killsByIce[event.iceId] = (state.killsByIce[event.iceId] ?? 0) + 1;
    if (key === "dragon" && profile.hangryHangryDragon) effects.push({ type: "restoreIceRez", iceId: event.iceId, rez: event.maxRez });
  } else if (event.type === "deathSave" && state.active && profile.combatRecorder && event.failed && event.otherNetrunner && event.sameArchitecture) {
    effects.push({ type: "recording", minutes: 5, value: 50, anonymized: true });
  }
  if (event.eventId) state.processedEventIds.push(event.eventId);
  return { state, effects };
}

/** Protection is scoped by source: Hardened Circuitry does NOT stop Black ICE.
 * forceJackOut/ignite only covers Program effects, not physical disconnection. */
export function equipmentProtection(profile, effect, { sourceKind = "program" } = {}) {
  const program = ["program", "blackice"].includes(sourceKind);
  if (effect === "ignite") return program && profile.insulatedWiring;
  if (effect === "forceJackOut") return program && profile.krashBarrier;
  if (["disableDeck", "destroyDeck", "inoperableDeck", "emp"].includes(effect)) {
    return profile.hardenedCircuitry && (sourceKind === "emp" || sourceKind === "program");
  }
  return false;
}

/** Armor reduction precedes the Training/MicroMate multiplier. armorReduction
 * is supplied by the program runtime; equipment itself grants no flat reduction. */
export function equipmentBrainDamage(amount, profile, { armorReduction = 0 } = {}) {
  return Math.max(0, Math.trunc(Number(amount) || 0) - armorReduction) * profile.brainDamageMultiplier;
}

/** Explicit switching plan; caller checks permissions/action economy, persists
 * selected deck and derezzes the returned source-deck programs. No shared loadout.
 * Integrated units may link cyberware decks confirmed by CPR isInstalledInActor. */
export function cyberConductorSwitchPlan(actor, deck, targetDeck) {
  const denied = { allowed: false, meatActions: 0, hpDamage: 0, derezProgramIds: [], reason: "notLinked" };
  if (!deck || !targetDeck || itemId(deck) === itemId(targetDeck)) return denied;
  const all = actorItems(actor);
  const profile = equipmentProfile(actor, deck);
  const target = equipmentProfile(actor, targetDeck);
  const conductor = all.find((i) => ["cyberConductor", "integratedCyberConductor"].includes(equipmentKey(i))
    && (i.system?.installedItems?.list?.includes(itemId(deck))
      || (equipmentKey(i) === "integratedCyberConductor" && i.system?.isInstalledInActor && profile.integratedCyberConductor))
    && (i.system?.installedItems?.list?.includes(itemId(targetDeck))
      || (equipmentKey(i) === "integratedCyberConductor" && i.system?.isInstalledInActor && target.integratedCyberConductor)));
  if (!conductor) return denied;
  const deckCount = installedEquipmentItems(actor, conductor).filter((i) => i.type === "cyberdeck").length;
  if (deckCount > 3) return { ...denied, reason: "conductorCapacity" };
  return { allowed: true, meatActions: 1, hpDamage: equipmentKey(conductor) === "integratedCyberConductor" ? 0 : 3,
    derezProgramIds: installedEquipmentItems(actor, deck).filter((i) => i.type === "program" && i.system?.isRezzed).map(itemId),
    targetDeckId: itemId(targetDeck), reason: null };
}
