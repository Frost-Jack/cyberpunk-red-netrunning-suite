/* Equipment state transitions. The GM data layer owns persistence/permissions.
 * Item IDs, not names, identify copies; hardware presence comes from the used deck. */
import { equipmentProfile, equipmentProgramKey, modifiedIceStats, programSwapPlan, cyberConductorSwitchPlan, validateEquipmentLoadout, equipmentProtection as protectionVerdict } from "./equipment.js";

const deckOf = actor => actor?.getEquippedCyberdeck?.() || null;
export const profileFor = actor => equipmentProfile(actor, deckOf(actor));
export const netActionBonus = actor => profileFor(actor).extraNetActions;
const programs = (actor, bridge) => bridge.installedPrograms(bridge.getDeck(actor)) || [];
function stateFor(session, pid) {
  session.equipment ||= {};
  const state = session.equipment[pid] ||= { snakeUsed: false, swiftyUsed: false, sequencer: false };
  state.kills ||= {}; state.backups ||= {}; state.destroyedThisRun ||= {};
  return state;
}
function usage(session, part) {
  const round = game.combat?.started ? `${game.combat.id}:${game.combat.round}` : `manual:${part.roundSerial || 0}`;
  session.programUsage ||= {};
  let used = session.programUsage[part.actorUuid];
  if (!used || used.round !== round) used = session.programUsage[part.actorUuid] = { round, ids: {} };
  return used;
}
async function freeRez(session, pid, actor, program, bridge) {
  const part = session.participants[pid], key = `${pid}|${program.id}`;
  if (program.system.isRezzed || session.destroyed?.[key] || session.defeated?.[key]
    || part.runUsedIds?.[program.id] || usage(session, part).ids[program.id]) return false;
  if (program.system.class === "defender" && programs(actor, bridge).some(p => p.system.isRezzed
    && !session.defeated?.[`${pid}|${p.id}`] && Number(p.system.rez?.value) > 0
    && equipmentProgramKey(p) === equipmentProgramKey(program))) return false;
  if (!await bridge.rezProgram(actor, program.id)) return false;
  usage(session, part).ids[program.id] = true;
  part.rezzed ||= {}; part.rezzed[program.id] = { rezzed: true };
  if (program.system.class === "defender") { part.runUsedIds ||= {}; part.runUsedIds[program.id] = true; }
  return true;
}
export async function onEquipmentJackIn(session, pid, actor, bridge) {
  const profile = profileFor(actor), state = stateFor(session, pid);
  // Backup storage survives a run; the consumable protections do not.
  Object.assign(state, { snakeUsed: false, swiftyUsed: false, swiftyPending: false, kills: {}, sequencer: false,
    scoutPending: profile.freePathfinder, scoutSerial: session.participants[pid]?.scoutActionSerial || 0, destroyedThisRun: {} });
  const list = programs(actor, bridge);
  if (profile.freeArmor) {
    for (const p of list.filter(p => equipmentProgramKey(p) === "armor")) {
      if (await freeRez(session, pid, actor, p, bridge)) break;
    }
  }
  let left = profile.freeSpeedy;
  for (const p of list.filter(p => equipmentProgramKey(p) === "speedyGonzalves")) {
    if (left > 0 && await freeRez(session, pid, actor, p, bridge)) left--;
  }
}
export async function onEquipmentJackOut(session, pid, actor, bridge, { safe = true } = {}) {
  const state = stateFor(session, pid), profile = profileFor(actor);
  if ((safe || profile.safeJackout) && profile.phoenix) {
    for (const program of programs(actor, bridge)) {
      const key = `${pid}|${program.id}`;
      if (!session.destroyed?.[key] || state.destroyedThisRun[program.id] !== deckOf(actor)?.id) continue;
      delete session.destroyed[key];
      delete session.defeated?.[key];
      delete state.backups[program.id];
      await program.update({ "system.rez.value": program.system.rez.max, "system.isRezzed": false });
    }
  }
  state.kills = {}; state.scoutPending = false; state.sequencer = false;
}
export function queueArmor(session, pid, actor, program) {
  if (equipmentProgramKey(program) === "armor" && program.system.isRezzed && profileFor(actor).defenseSequencer) {
    stateFor(session, pid).sequencer = true;
  }
}
export async function onEquipmentTurn(session, pid, actor, bridge) {
  const state = stateFor(session, pid);
  state.scoutPending = false;
  if (!state.sequencer || !profileFor(actor).defenseSequencer) return;
  state.sequencer = false;
  for (const program of programs(actor, bridge).filter(p => equipmentProgramKey(p) === "armor")) {
    if (await freeRez(session, pid, actor, program, bridge)) break;
  }
}
export async function beforeEquipmentDestroy(session, pid, programId, actor, bridge, { random = false, sourceKind = "program" } = {}) {
  const profile = profileFor(actor), state = stateFor(session, pid);
  const program = actor?.getOwnedItem?.(programId);
  if (!program) return true;
  if (["program", "blackice"].includes(sourceKind) && profile.functionDriverProgramId === programId) return false;
  if (random && ["program", "blackice"].includes(sourceKind) && profile.snaketrap && !state.snakeUsed) { state.snakeUsed = true; return false; }
  state.destroyedThisRun[programId] = deckOf(actor)?.id;
  queueArmor(session, pid, actor, program);
  if (profile.backupDrive && ["antipersonnelattacker", "antiprogramattacker", "attacker", "defender", "booster"].includes(program.system.class)) {
    state.backups[programId] = { name: program.name,
      deckId: deckOf(actor)?.id, usedThisRun: !!session.participants[pid]?.runUsedIds?.[programId],
      driveIds: [...profile.backupDriveIds] };
  }
  return true;
}
function sourceProgram(session, ref, bridge) {
  if (!ref?.startsWith("prog:")) return null;
  const [, pid, id] = ref.split(":"), part = session.participants?.[pid];
  const owner = part?.actorUuid ? fromUuidSync(part.actorUuid) : null;
  return owner ? { owner, pid, program: programs(owner, bridge).find(p => p.id === id), key: `${pid}|${id}` } : null;
}
export async function afterEquipmentDestroy(session, sourceRef, bridge) {
  const source = sourceProgram(session, sourceRef, bridge);
  if (!source?.program) return;
  const profile = profileFor(source.owner), kind = equipmentProgramKey(source.program);
  const state = stateFor(session, source.pid);
  if (kind === "sabertooth" && profile.felineInstinct) state.kills[source.program.id] = (state.kills[source.program.id] || 0) + 1;
  if (kind === "dragon" && profile.hangryHangryDragon) {
    const actorId = session.progState?.[source.key]?.actorId;
    if (actorId) await bridge.restoreEntity(actorId);
    await source.program.update({ "system.rez.value": source.program.system.rez.max });
  }
}
export function equipmentIceStats(session, pid, actor, program) {
  const s = program.system || {};
  return modifiedIceStats({ key: equipmentProgramKey(program), name: program.name, per: s.per, spd: s.spd, atk: s.atk, def: s.def,
    rez: s.rez?.value, rezMax: s.rez?.max, blackIceType: s.blackIceType }, profileFor(actor),
  { kills: stateFor(session, pid).kills[program.id] || 0 });
}
export function equipmentDamageFormula(session, sourceRef, bridge, fallback) {
  const source = sourceProgram(session, sourceRef, bridge);
  if (!source?.program) return fallback;
  const modified = equipmentIceStats(session, source.pid, source.owner, source.program);
  return modified.damageDice > 0 ? modified.damageFormula : fallback;
}
export async function equipmentBrainDamage(session, pid, actor, amount, bridge, { isBlackIce = true } = {}) {
  let damage = Math.max(0, Math.trunc(Number(amount) || 0));
  const list = programs(actor, bridge).filter(p => p.system.isRezzed && Number(p.system.rez?.value) > 0
    && !session.defeated?.[`${pid}|${p.id}`] && !session.destroyed?.[`${pid}|${p.id}`]);
  const shield = !isBlackIce && list.find(p => equipmentProgramKey(p) === "shield");
  if (shield && damage > 0) {
    session.defeated ||= {}; session.defeated[`${pid}|${shield.id}`] = true;
    await shield.update({ "system.rez.value": 0 });
    await bridge.setProgramDefeated?.(actor, shield.id, true);
    damage = 0;
  }
  if (list.some(p => equipmentProgramKey(p) === "armor")) damage = Math.max(0, damage - 4);
  return damage * profileFor(actor).brainDamageMultiplier;
}
/** Explicit hardware actions use a Meat Action, except immediate Scout/Swifty rolls. */
export async function equipmentAction(session, pid, action, actor, bridge, { deckId = "" } = {}) {
  const part = session.participants?.[pid], state = stateFor(session, pid), profile = profileFor(actor);
  if (!part) return false;
  if (action === "swiftyCancel" && state.swiftyPending) {
    state.swiftyPending = false; state.swiftyUsed = false;
    part.actions.value = Math.min(part.actions.max, part.actions.value + 1);
    part.netActionTurn = state.swiftyPreviousTurn;
    if ((part.scoutActionSerial || 0) === state.swiftyActionSerial) part.scoutActionSerial = state.swiftyPreviousSerial;
    return { ok: true };
  }
  if (action === "scout") {
    if (!state.scoutPending || !profile.freePathfinder || !part.jackedIn
      || (part.scoutActionSerial || 0) !== state.scoutSerial) return false;
    state.scoutPending = false;
    return { ok: true, ability: "pathfinder" };
  }
  if (action === "swifty") {
    if (!profile.swiftyClean || state.swiftyUsed || !part.jackedIn) return false;
    if ((part.actions?.value || 0) < 1) return { error: "CRNS.Errors.NoActions" };
    const turn = game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : `manual:${part.turnSerial || 0}`;
    if (part.meatActionTurn === turn) return { error: "CRNS.Rules.MeatActionUsed" };
    part.actions.value--; state.swiftyUsed = true; state.swiftyPending = true;
    state.swiftyPreviousTurn = part.netActionTurn ?? null;
    state.swiftyPreviousSerial = part.scoutActionSerial || 0;
    state.swiftyActionSerial = part.scoutActionSerial = state.swiftyPreviousSerial + 1;
    part.netActionTurn = turn;
    return { ok: true, ability: "cloak", rolls: 2 };
  }
  const turn = game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : `manual:${part.turnSerial || 0}`;
  if (part.meatActionTurn === turn || part.netActionTurn === turn) return { error: "CRNS.Rules.MeatActionUsed" };
  if (action === "extinguish") {
    part.netEffects ||= {}; part.netEffects.fire = false;
  } else if (action === "restore" && profile.backupDrive) {
    // A removed/reinstalled drive cannot recover its former contents.
    for (const [id, copy] of Object.entries(state.backups)) {
      if (!copy.driveIds.some(drive => profile.backupDriveIds.includes(drive))) { delete state.backups[id]; continue; }
    }
    const current = bridge.getDeck(actor);
    const restoring = Object.keys(state.backups).filter(id => {
      const copy = state.backups[id];
      return (!copy.deckId || copy.deckId === current?.id) && profile.installedProgramIds.includes(id) && session.destroyed?.[`${pid}|${id}`];
    });
    if (!restoring.length) return false;
    const excludedProgramIds = programs(actor, bridge).filter(p => session.destroyed?.[`${pid}|${p.id}`] && !restoring.includes(p.id)).map(p => p.id);
    const loadout = validateEquipmentLoadout(actor, current, { excludedProgramIds });
    if (!loadout.valid) return { error: "CRNS.Equipment.InvalidLoadout", details: loadout.errors };
    for (const id of restoring) {
      const copy = state.backups[id];
      const program = actor.getOwnedItem(id);
      if (program && session.destroyed?.[`${pid}|${id}`]) {
        await program.update({ "system.isRezzed": false, "system.rez.value": program.system.rez.max });
        delete session.destroyed[`${pid}|${id}`]; delete session.defeated?.[`${pid}|${id}`];
        if (copy.usedThisRun) { part.runUsedIds ||= {}; part.runUsedIds[id] = true; }
        delete state.backups[id];
      }
    }
  } else if (action === "switch" && profile.cyberConductor) {
    if (!part.jackedIn) return false;
    const current = bridge.getDeck(actor), next = actor.getOwnedItem(deckId);
    if (!next || next.type !== "cyberdeck" || next.id === current?.id) return false;
    const switchPlan = cyberConductorSwitchPlan(actor, current, next);
    if (!switchPlan.allowed) return { error: "CRNS.Equipment.NoConductorDeck" };
    for (const program of programs(actor, bridge)) {
      const key = `${pid}|${program.id}`, state = session.progState?.[key];
      if (program.system.isRezzed) {
        await program.update({ "system.rez.value": 0 });
        session.defeated ||= {}; session.defeated[key] = true;
        await bridge.setProgramDefeated?.(actor, program.id, true);
      }
      if (state?.actorId) await bridge.deleteEntityActors([state.actorId]);
      delete session.progState?.[key]; delete session.progFloors?.[key];
      session.attachments = (session.attachments || []).filter(a => a.progKey !== key);
      session.pendingTests = (session.pendingTests || []).filter(t => t.progKey !== key && t.ref !== `prog:${pid}:${program.id}`);
    }
    await actor.updateEmbeddedDocuments("Item", [{ _id: current.id, "system.equipped": "owned" }, { _id: next.id, "system.equipped": "equipped" }]);
    if (switchPlan.hpDamage) await bridge.damageRunnerHp(actor.id, switchPlan.hpDamage);
    part.rezzed = {};
    state.sequencer = false;
    const max = bridge.netActionsMax(bridge.getInterfaceRank(actor)) + netActionBonus(actor);
    part.actions.max = max; part.actions.value = Math.min(max, part.actions.value);
  } else if (action === "smithy" && profile.smithy) {
    const installed = programs(actor, bridge).filter(program => !session.destroyed?.[`${pid}|${program.id}`]);
    const plan = programSwapPlan(profile, { programs: installed });
    if (!plan.allowed) return { error: "CRNS.Equipment.RestrictedSwap" };
    for (const program of installed) {
      const kind = equipmentProgramKey(program);
      if (kind !== "sword" && kind !== "banhammer") continue;
      const sword = kind === "banhammer";
      await program.update({ name: sword ? "Sword" : "Banhammer", "system.atk": 1,
        "flags.cyberpunk-red-netrunning-suite.programKey": sword ? "sword" : "banhammer",
        "system.damage.standard": sword ? "2d6" : "3d6", "system.damage.blackIce": sword ? "3d6" : "2d6" });
    }
  } else return false;
  part.meatActionTurn = turn;
  part.scoutActionSerial = (part.scoutActionSerial || 0) + 1;
  return { ok: true };
}
/** Protection verdicts are shared by GM-applied effects, not hidden in tooltip text. */
export function equipmentProtection(actor, effect, options = {}) {
  return protectionVerdict(profileFor(actor), effect, options);
}
