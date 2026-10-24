/* World data layer.
 *
 * All shared state lives in world-scoped settings (type Object). Only a GM
 * client may write them, so player mutations are relayed over the module
 * socket to the primary GM, who validates and applies them. Every write
 * triggers the core `updateSetting` broadcast, which re-renders open suites
 * on all clients — no manual refresh fan-out is needed for data changes.
 */

import { MODULE_ID, SOCKET_NAME, uid, loc, BLACK_ICE, DEMONS, FLOOR_KINDS, MAX_ICE_PER_FLOOR, maxDemons, blackIceTypeForName } from "./constants.js";
import * as bridge from "./cpr-bridge.js";
import { topology, pathfinderFloors } from "./topology.js";
import { contentOperation } from "./custom-content.js";
import { equipmentProfile, validateEquipmentLoadout } from "./equipment.js";
import { netActionBonus, onEquipmentJackIn, onEquipmentJackOut, onEquipmentTurn, beforeEquipmentDestroy, afterEquipmentDestroy, equipmentIceStats, equipmentBrainDamage, queueArmor, equipmentAction, equipmentProtection } from "./equipment-runtime.js";

const FLOOR_KINDS_SET = new Set(FLOOR_KINDS);

/* World-setting defaults. main.js registers each key from this dict. */
export const WORLD_OBJECTS = {
  netTree: [],
  treeState: {},
  customContent: {},
  netArchs: {},
  // Current entity REZ lives on the backing blackIce/demon Actor, not here.
  session: {
    tabs: [], activeTab: "", participants: {}, targets: {}, demonPrograms: {},
    progFloors: {}, pendingTests: [],
    // Round-2 (SPEC §14):
    floorState: {},    // "<archId>:<floorId>" -> FloorFx (breach/virus/control/eyedee)
    cloaks: {},        // "<archId>" -> [{id, n, pid, dv}]  — arch-level cloak markers (Addendum 6)
    reveal: {},        // "<pid>" -> { "<archId>": floorIds[] | legacy maxVisibleFloorIndex }
    slid: [],          // [{archId, iceId|progKey, pid}] — ICE this runner slid past (never re-attaches)
    attachments: [],   // [{archId, iceId|progKey, pid}] — ICE following a player's runner
    demonState: {},    // "<actorId>" -> { value, max }  — demon NET-action counter
    progState: {},     // "<pid>|<programId>" -> { mode:"trap"|"deployed", targetRef, floorIndex }
    destroyed: {},     // Explicit destruction, distinct from defeat at 0 REZ.
    defeated: {},
    programUsage: {},  // actor UUID -> { round, ids }; survives reconnects.
  },
};

/* ------------------------------------------------------------------ */
/* Generic access                                                      */
/* ------------------------------------------------------------------ */

export function getWorld(key) {
  try { return foundry.utils.deepClone(game.settings.get(MODULE_ID, key)); }
  catch (e) { return null; }
}

export async function setWorld(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

export function primaryGM() {
  return game.users.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

export function isPrimaryGM() {
  return primaryGM()?.id === game.user.id;
}

/* Pending player-side mutation requests awaiting the GM's result. */
const _pendingMutations = new Map(); // requestId -> resolve

/** Mutate shared world data. The primary GM applies locally; other users relay
 *  await the GM's result over the socket (10s timeout -> null). */
export async function mutate(op, payload = {}) {
  if (isPrimaryGM()) {
    return applyOp(op, payload, game.user.id);
  }
  const gm = primaryGM();
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("CRNS.Errors.NoGm"));
    return false;
  }
  const requestId = foundry.utils.randomID(16);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (_pendingMutations.delete(requestId)) resolve(null);
    }, 10000);
    _pendingMutations.set(requestId, { gmId: gm.id, resolve: (result) => {
      clearTimeout(timer);
      resolve(result);
    } });
    game.socket.emit(SOCKET_NAME, { action: "mutate", op, payload, userId: game.user.id, requestId });
  });
}

/** Called by the socket router when the GM reports a mutation result. */
export function resolveMutation(requestId, result, gmId) {
  const pending = _pendingMutations.get(requestId);
  if (!pending || pending.gmId !== gmId) return;
  _pendingMutations.delete(requestId);
  pending.resolve(result);
}

/* ------------------------------------------------------------------ */
/* Notification fan-out (GM side)                                      */
/* ------------------------------------------------------------------ */

export function notifyClients(data) {
  game.socket.emit(SOCKET_NAME, { action: "notify", ...data });
  // The emitting GM does not receive its own socket message.
  Hooks.callAll(`${MODULE_ID}.notify`, data);
}

/* ------------------------------------------------------------------ */
/* Operations (executed on a GM client only)                           */
/* ------------------------------------------------------------------ */

function requesterIsGM(userId) {
  return game.users.get(userId)?.isGM ?? false;
}

/* ------------------------------------------------------------------ */
/* Phase C helpers (session participants / entity refs)                 */
/* ------------------------------------------------------------------ */

/** Does the given user own this participant record? Runners: by userId, or by
 *  OWNER permission on the backing actor when userId is unset. Spectators: by
 *  userId. GM-added NPC runners (userId "") are GM-only — never "owned". */
function ownsParticipant(part, userId) {
  if (!part || !userId) return false;
  if (part.userId && part.userId === userId) return true;
  if (part.kind === "runner" && !part.userId && part.actorUuid) {
    const user = game.users.get(userId);
    const actor = fromUuidSync?.(part.actorUuid) ?? null;
    // Only non-GM owners of the actor; NPC runners stay GM-controlled otherwise.
    if (user && !user.isGM && actor?.testUserPermission?.(user, "OWNER")) return true;
  }
  return false;
}

/** Is this a PLAYER-owned runner participant — a runner whose userId maps to a
 *  non-GM active/inactive user? GM-added NPC runners (userId "") are excluded.
 *  Used by the spectators rework (SPEC §13): only archs holding such a runner are
 *  spectatable, and a spectator's fog is derived from these runners. */
export function isPlayerRunner(part) {
  if (!part || part.kind !== "runner" || !part.userId) return false;
  const user = game.users?.get(part.userId);
  return !!user && !user.isGM;
}

/** A player runner currently available as a spectator's point of view. */
export function isSpectatableRunner(part, archs) {
  return isPlayerRunner(part) && !!part.archId && part.jackedIn !== false && !!archs?.[part.archId];
}

/** Arch ids that currently hold at least one PLAYER-owned runner (SPEC §13). */
export function playerRunnerArchIds(session) {
  const ids = new Set();
  for (const p of Object.values(session?.participants || {})) {
    if (p.archId && isPlayerRunner(p)) ids.add(p.archId);
  }
  return [...ids];
}

/** Recompute a runner participant's NET-action maximum from its Interface rank
 *  (falls back to the stored max, else 2, when the actor can't be resolved). */
function participantActionMax(part) {
  const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  if (actor) return bridge.netActionsMax(bridge.getInterfaceRank(actor)) + netActionBonus(actor);
  return part?.actions?.max ?? 2;
}

const ENTITY_REF_PREFIXES = new Set(["ice", "demon", "runner", "prog"]);

/** Validate an entityRef's prefix (ice:|demon:|runner:|prog:). */
function validEntityRef(ref) {
  if (typeof ref !== "string" || !ref) return false;
  return ENTITY_REF_PREFIXES.has(ref.split(":")[0]);
}

/** Resolve an "ice:<archId>:<floorId>:<entId>" / "demon:…" target ref to its
 *  backing actorId, using the current netArchs floors. "" if it doesn't resolve. */
function refActorId(ref) {
  const [kind, archId, floorId, entId] = (ref || "").split(":");
  if (kind !== "ice" && kind !== "demon") return "";
  const arch = (getWorld("netArchs") || {})[archId];
  const floor = (arch?.floors || []).find((f) => f.id === floorId);
  if (!floor) return "";
  const def = kind === "ice"
    ? (floor.ice || []).find((i) => i.id === entId)
    : (floor.demon && floor.demon.id === entId ? floor.demon : null);
  return def?.actorId || "";
}

/** Damage requires an acting runner on the target's floor; spectators cannot act. */
function canDamageTarget(session, ref, userId) {
  const [kind, a, floorId, entityId] = String(ref || "").split(":");
  let archId = "", floorIndex = -1;
  if (kind === "ice" || kind === "demon") {
    const arch = (getWorld("netArchs") || {})[a];
    archId = a;
    floorIndex = (arch?.floors || []).findIndex((f) => f.id === floorId);
    if (!entityId || !refActorId(ref)) return false;
  } else if (kind === "prog") {
    const owner = session.participants?.[a];
    if (!owner?.archId || owner.jackedIn === false || !activeProgramRefs(session, a).includes(ref)) return false;
    archId = owner.archId;
    floorIndex = Number(session.progState?.[`${a}|${floorId}`]?.floorIndex ?? owner.floorIndex ?? 0);
  } else return false;
  return floorIndex >= 0 && Object.values(session.participants || {}).some((p) => p.kind === "runner"
    && p.jackedIn !== false && p.archId === archId && Number(p.floorIndex || 0) === floorIndex && ownsParticipant(p, userId));
}

/** Clamp a damage amount to a whole number in 1..500. NaN → 0 (no-op damage). */
function clampDamage(amount) {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(500, n));
}

export function roundKey(part = {}) {
  return game.combat?.started ? `${game.combat.id}:${game.combat.round}` : `manual:${part.roundSerial || 0}`;
}

export function turnKey(part = {}) {
  return game.combat?.started ? `${roundKey(part)}:${game.combat.turn}` : `manual:${part.turnSerial || 0}`;
}

export function combatantMatchesActor(combatant, actorUuid, actorId) {
  if (!combatant || (!actorUuid && !actorId)) return false;
  if (actorUuid && combatant.actor?.uuid === actorUuid) return true;
  return !!actorId && (!actorUuid || actorUuid === `Actor.${actorId}`)
    && (combatant.actorId || combatant.actor?.id) === actorId;
}

export function programUsed(session, part, programId) {
  const usage = session.programUsage?.[part.actorUuid];
  return usage?.round === roundKey(part) && !!usage.ids?.[programId];
}

function rememberProgram(session, part, programId) {
  session.programUsage ||= {};
  let usage = session.programUsage[part.actorUuid];
  if (!usage || usage.round !== roundKey(part)) usage = session.programUsage[part.actorUuid] = { round: roundKey(part), ids: {} };
  usage.ids[programId] = true;
  part.rezUsedIds = usage.ids;
}

function spendNet(part, n = 1, override = false) {
  if (override) return true;
  if (part.netEffects?.deckDisabled) return { error: "CRNS.Equipment.DeckDisabled" };
  if (part.meatActionTurn === turnKey(part)) return { error: "CRNS.Rules.MeatActionUsed" };
  if (!Number.isInteger(n) || n < 1 || (part.actions?.value || 0) < n) return { error: "CRNS.Errors.NoActions" };
  part.actions.value -= n;
  part.scoutActionSerial = (part.scoutActionSerial || 0) + 1;
  part.netActionTurn = turnKey(part);
  return true;
}

function programName(program) {
  const custom = bridge.programDefinition?.(program);
  if (custom) return `custom:${custom.id}`;
  const raw = String(program?.name || "").toLowerCase().replace(/[\s-]/g, "");
  for (const key of ["Superglue", "Armor", "Flak", "Shield"]) {
    if ([key, loc(`CRNS.Program.${key}.name`)].some((n) => String(n).toLowerCase().replace(/[\s-]/g, "") === raw)) return key.toLowerCase();
  }
  return raw;
}

export function activeProgramRefs(session, pid, source = null) {
  const part = session.participants?.[pid];
  const custom = source ? bridge.programDefinition?.(source) : null;
  const actor = part?.actorUuid ? fromUuidSync(part.actorUuid) : null;
  return (bridge.installedPrograms(bridge.getDeck(actor)) || []).filter((p) => {
    const key = `${pid}|${p.id}`;
    if (!p.system?.isRezzed || session.destroyed?.[key] || session.defeated?.[key]) return false;
    if (custom && !custom.targets.includes(p.system.class === "blackice" ? "blackIce" : "program")) return false;
    const ps = session.progState?.[key];
    if (p.system.class === "blackice" && ps && Number(ps.floorIndex) !== Number(part.floorIndex || 0)) return false;
    const rez = ps?.actorId ? game.actors.get(ps.actorId)?.system?.stats?.rez?.value : p.system.rez?.value;
    return !(Number(p.system.rez?.max) > 0 && Number(rez) <= 0);
  }).map((p) => `prog:${pid}:${p.id}`);
}

function isAntiProgram(actor, type = "") {
  const nativeClass = actor?.type === "blackIce" ? actor?.system?.class : actor?.system?.blackIceType;
  if (["antiprogram", "antipersonnel", "other"].includes(nativeClass)) return nativeClass === "antiprogram";
  if (bridge.programDefinition?.(actor)) return false;
  return BLACK_ICE[type || blackIceTypeForName(actor?.name)]?.tgt === "P"
    || actor?.system?.blackIceType === "antiprogram";
}

export function slideDestinations(session, pid) {
  const part = session.participants?.[pid];
  const arch = (getWorld("netArchs") || {})[part?.archId];
  const graph = topology(arch);
  if (graph.error) return [];
  const from = part.floorIndex || 0;
  return arch.floors.flatMap((f, i) => {
    const adjacent = graph.parents[from] === i || graph.parents[i] === from;
    const blocked = graph.parents[i] === from && isBlockingPasswordFloor(session, part.archId, arch.floors[from]);
    return adjacent && !blocked ? [{ floorIndex: i, label: `${i + 1}. ${f.label || loc(`CRNS.Floor.${f.kind}`)}` }] : [];
  });
}

function destroysProgram({ sourceRef = "", sourceName = "", sourceProgram = null, effect = "" } = {}, callerId) {
  if (effect === "destroy" && requesterIsGM(callerId)) return true;
  let actor = game.actors?.get(refActorId(sourceRef));
  if (sourceRef.startsWith("prog:")) {
    const [, pid, id] = sourceRef.split(":");
    const part = (getWorld("session") || {}).participants?.[pid];
    actor = part?.actorUuid ? fromUuidSync(part.actorUuid)?.getOwnedItem?.(id) : null;
  }
  const type = blackIceTypeForName(actor?.name || (requesterIsGM(callerId) ? sourceName || sourceProgram?.name : ""));
  const custom = bridge.programDefinition?.(actor);
  if (custom) return custom.effects.some(e => e.type === "destroy");
  return ["dragon", "killer", "sabertooth"].includes(type);
}

async function defeatProgram(session, pid, programId, source, callerId) {
  if (destroysProgram(source, callerId)) {
    const destroyed = await autoDerezDestroyedProg(session, pid, programId, source);
    if (destroyed) { await afterEquipmentDestroy(session, source?.sourceRef, bridge); return true; }
  }
  const key = `${pid}|${programId}`;
  session.defeated ||= {};
  session.defeated[key] = true;
  const part = session.participants?.[pid];
  const owner = part?.actorUuid ? fromUuidSync(part.actorUuid) : null;
  const item = owner?.getOwnedItem?.(programId);
  if (item) queueArmor(session, pid, owner, item);
  if (item) await item.update({ "system.rez.value": 0 });
  if (owner) await bridge.setProgramDefeated(owner, programId, true);
  pruneProgBiSideEffects(session, session.progState?.[key]?.actorId, key);
  postChatCard(loc("CRNS.Rules.Derezzed"), item?.name || "");
  return true;
}

/* ------------------------------------------------------------------ */
/* Round-2 helpers (SPEC §14) — floor state / fog / attachments         */
/* ------------------------------------------------------------------ */

/** Key for a floor's FloorFx record: "<archId>:<floorId>". */
function floorKey(archId, floorId) { return `${archId}:${floorId}`; }

/** A fresh, empty FloorFx record. (Cloaks are arch-level now — see session.cloaks
 *  and archCloaks(); Addendum 6.) */
function emptyFloorFx() {
  return { breached: false, viruses: [], control: null, eyedee: [] };
}

/** Get (creating on demand) the FloorFx for a floor. Mutating the return value
 *  and then calling setWorld("session") persists it. */
function getFloorFx(session, archId, floorId) {
  session.floorState = session.floorState || {};
  const key = floorKey(archId, floorId);
  const cur = session.floorState[key];
  const fx = { ...emptyFloorFx(), ...(cur || {}) };
  // Normalize array/object shapes in case a partial record was stored.
  fx.viruses = Array.isArray(fx.viruses) ? fx.viruses : [];
  fx.eyedee = Array.isArray(fx.eyedee) ? fx.eyedee : [];
  fx.control = fx.control || null;
  session.floorState[key] = fx;
  return fx;
}

/** The arch-level cloak marker list (creating on demand). Addendum 6. */
function archCloaks(session, archId) {
  session.cloaks = session.cloaks || {};
  if (!Array.isArray(session.cloaks[archId])) session.cloaks[archId] = [];
  return session.cloaks[archId];
}

/** Resolve a participant's current floor object from netArchs. */
function participantFloor(part, archs) {
  const floors = archs?.[part?.archId]?.floors || [];
  return floors[part?.floorIndex || 0] || null;
}

/** Resolve payload.pid to a participant the caller may act for (owner-or-GM).
 *  Returns { session, part, pid } or null (invalid / not permitted). */
function resolveActingRunner(session, pid, callerId) {
  const part = (session.participants || {})[pid];
  if (!part || part.kind !== "runner") return null;
  if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return null;
  return { part, pid };
}

/** Move an ICE def (by iceId) to another floor of the same arch, rewriting any
 *  session.targets ice: refs whose floorId changed. Runtime follow moves ignore
 *  the 3-per-floor editor cap. Mutates `archs` (persist via setWorld) and
 *  `session.targets`. Returns true if the def moved. Shared by ent.move-like
 *  logic and attachment follow. */
function moveIceDefToFloor(session, archs, archId, iceId, toFloorIndex) {
  const arch = archs?.[archId];
  const floors = arch?.floors || [];
  const target = floors[toFloorIndex];
  if (!target) return false;

  let srcFloor = null, def = null, srcIndex = -1;
  for (const floor of floors) {
    const idx = (floor.ice || []).findIndex((i) => i.id === iceId);
    if (idx >= 0) { srcFloor = floor; def = floor.ice[idx]; srcIndex = idx; break; }
  }
  if (!srcFloor || !def) return false;
  if (srcFloor.id === target.id) return false; // already there.

  srcFloor.ice.splice(srcIndex, 1);
  target.ice = target.ice || [];
  target.ice.push(def);

  // Rewrite ice: targets referencing the old floorId.
  for (const [uid_, ref] of Object.entries(session.targets || {})) {
    const [rKind, rArch, rFloor, rEnt] = (ref || "").split(":");
    if (rKind === "ice" && rArch === archId && rFloor === srcFloor.id && rEnt === iceId) {
      session.targets[uid_] = `ice:${archId}:${target.id}:${iceId}`;
    }
  }
  return true;
}

/** Drop attachments matching a predicate. Returns true if any removed. */
function pruneAttachments(session, predicate) {
  const list = session.attachments;
  if (!Array.isArray(list) || !list.length) return false;
  const kept = list.filter((a) => !predicate(a));
  if (kept.length === list.length) return false;
  session.attachments = kept;
  return true;
}

/** Delete every progState belonging to a participant, and prune the reaction
 *  side-effects (pendingTests / attachments / slid) each of those player BIs
 *  provoked (Addendum 2). Returns true if it changed anything. */
function clearProgState(session, pid) {
  const ps = session.progState;
  let changed = false;
  const prefix = `${pid}|`;
  if (ps) {
    for (const key of Object.keys(ps)) {
      if (!key.startsWith(prefix)) continue;
      const actorId = ps[key]?.actorId || "";
      delete ps[key];
      changed = true;
      pruneProgBiSideEffects(session, actorId, key);
    }
  }
  return changed;
}

/** Prune the reaction side-effects of a player-placed Black ICE (Addendum 2):
 *  pendingTests it provoked (by its backing actorId), and the attachments / slid
 *  records keyed on its progKey. Call when a player BI is derezzed / removed.
 *  Returns true if anything changed. */
function pruneProgBiSideEffects(session, actorId, progKey) {
  let changed = false;
  if (actorId && prunePendingTests(session, (t) => t.iceActorId === actorId)) changed = true;
  if (progKey) {
    const ref = `prog:${progKey.replace("|", ":")}`;
    for (const [userId, target] of Object.entries(session.targets || {})) {
      if (target === ref) { delete session.targets[userId]; changed = true; }
    }
    for (const st of Object.values(session.progState || {})) {
      if (st.targetRef === ref) { st.targetRef = ""; changed = true; }
    }
    if (pruneAttachments(session, (a) => a.progKey === progKey)) changed = true;
    const sBefore = (session.slid || []).length;
    session.slid = (session.slid || []).filter((s) => s.progKey !== progKey);
    if ((session.slid || []).length !== sBefore) changed = true;
  }
  return changed;
}

/** Drop references to a runner leaving the current run, including in-flight rolls. */
function clearRunnerReferences(session, pid) {
  for (const fx of Object.values(session.floorState || {})) if (fx?.control?.pid === pid) fx.control = null;
  const archId = session.participants?.[pid]?.archId;
  if (archId && !Object.entries(session.participants || {}).some(([otherPid, part]) => otherPid !== pid
    && part.kind === "runner" && part.archId === archId && part.jackedIn !== false)) {
    for (const [key, fx] of Object.entries(session.floorState || {})) {
      if (key.startsWith(`${archId}:`)) { fx.breached = false; fx.control = null; }
    }
  }
  const matches = (ref) => ref === `runner:${pid}` || (typeof ref === "string" && ref.startsWith(`prog:${pid}:`));
  for (const [userId, ref] of Object.entries(session.targets || {})) if (matches(ref)) delete session.targets[userId];
  for (const st of Object.values(session.progState || {})) if (matches(st.targetRef)) st.targetRef = "";
  prunePendingTests(session, (t) => t.pid === pid || matches(t.ref) || matches(t.targetRef));
  pruneAttachments(session, (a) => a.pid === pid);
  session.slid = (session.slid || []).filter((s) => s.pid !== pid);
  const part = session.participants?.[pid];
  if (part) { part.slideAttempt = null; part.activations = {}; }
  if (part?.userId && session.targets) delete session.targets[part.userId];
}

/** Remove exact document refs after a core document deletion, without touching other documents. */
function pruneDeletedRefs(session, refs) {
  for (const [userId, ref] of Object.entries(session.targets || {})) if (refs.has(ref)) delete session.targets[userId];
  for (const state of Object.values(session.progState || {})) if (refs.has(state.targetRef)) state.targetRef = "";
  for (const part of Object.values(session.participants || {})) if (refs.has(part.slideAttempt?.targetRef)) part.slideAttempt = null;
  prunePendingTests(session, test => refs.has(test.ref) || refs.has(test.targetRef));
}

async function clearDeletedProgram(session, pid, programId, { derez = false, forgetUsage = false } = {}) {
  const part = session.participants?.[pid];
  const owner = part?.actorUuid ? fromUuidSync(part.actorUuid) : null;
  const program = owner?.getOwnedItem?.(programId);
  if (derez && program?.system?.isRezzed && !await bridge.derezProgram(owner, programId)) return false;
  const key = `${pid}|${programId}`;
  const actorId = session.progState?.[key]?.actorId;
  await deleteProgActors(session, pid, programId);
  if (part?.rezzed) delete part.rezzed[programId];
  if (part?.activations) delete part.activations[programId];
  if (session.progState) delete session.progState[key];
  if (session.progFloors) delete session.progFloors[key];
  if (session.defeated) delete session.defeated[key];
  if (forgetUsage) {
    if (session.destroyed) delete session.destroyed[key];
    if (part?.runUsedIds) delete part.runUsedIds[programId];
    if (part?.rezUsedIds) delete part.rezUsedIds[programId];
    const usage = session.programUsage?.[part?.actorUuid];
    if (usage?.ids) delete usage.ids[programId];
  }
  pruneProgBiSideEffects(session, actorId, key);
  pruneDeletedRefs(session, new Set([`prog:${pid}:${programId}`]));
  return true;
}

/** All backing prog-ICE actorIds for a participant's progState (SPEC §14.12 /
 *  Task 1). Used to delete the actors when the prog state is cleared (derez /
 *  jack-out / disconnect / removal). */
function progActorIdsForPid(session, pid) {
  const ps = session.progState || {};
  const out = [];
  const prefix = `${pid}|`;
  for (const [key, st] of Object.entries(ps)) {
    if (key.startsWith(prefix) && st?.actorId) out.push(st.actorId);
  }
  return out;
}

/** Reverse-lookup: the "<pid>|<programId>" key of the player Black-ICE program
 *  whose backing prog-ICE actor is `actorId` (or null). Lets a plain ent.damage
 *  on a deployed/trap BI's actor route into the shared destruction cleanup. */
function progKeyForActorId(session, actorId) {
  if (!actorId) return null;
  for (const [key, st] of Object.entries(session.progState || {})) {
    if (st?.actorId === actorId) return key;
  }
  return null;
}

/** Delete the backing prog-ICE actors for a participant (or a single program).
 *  Reads progState BEFORE the caller clears it, so call this first. GM-side. */
async function deleteProgActors(session, pid, programId = null) {
  const ps = session.progState || {};
  const ids = [];
  const prefix = `${pid}|`;
  for (const [key, st] of Object.entries(ps)) {
    if (!key.startsWith(prefix) || !st?.actorId) continue;
    if (programId && key !== `${pid}|${programId}`) continue;
    ids.push(st.actorId);
  }
  if (ids.length) await bridge.deleteEntityActors(ids);
}

/** A player-placed Black-ICE program (prog: target) was destroyed by damage
 *  (backing actor REZ ≤ 0) — automatically DEREZ it GM-side, mirroring a manual
 *  derez (Task 2): delete its backing prog actor, derez the program item on the
 *  owner's actor (bridge.derezProgram — restores item REZ per module rule), clear
 *  the progState/progFloors entry + the owner's rezzed mirror, and prune the
 *  reaction side-effects (pendingTests/attachments/slid) it provoked. Mutates
 *  `session` in place (caller persists). GM-side only. Returns true if it acted. */
async function autoDerezDestroyedProg(session, pid, programId, source = {}) {
  const part = (session.participants || {})[pid];
  if (!part) return false;
  const progKey = `${pid}|${programId}`;
  const actorId = (session.progState || {})[progKey]?.actorId || "";

  // Derez the program item on the owner's actor (GM client owns everything).
  const owner = part.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  if (!await beforeEquipmentDestroy(session, pid, programId, owner, bridge, { ...source, random: source?.random })) return false;
  if (owner) await bridge.derezProgram(owner, programId);
  if (session.defeated) delete session.defeated[progKey];
  postDestroyedCard(owner?.getOwnedItem?.(programId)?.name || "");

  // Delete the backing prog-ICE actor (read progState BEFORE clearing it).
  await deleteProgActors(session, pid, programId);

  // Clear the mirror + floor override + prog state.
  if (part.rezzed) delete part.rezzed[programId];
  if (session.progFloors) delete session.progFloors[progKey];
  if (session.progState) delete session.progState[progKey];

  // Lock the program out for the rest of the run (§10): it renders BROKEN and
  // cannot be re-activated until the GM restores it or the owner disconnects.
  session.destroyed = session.destroyed || {};
  session.destroyed[progKey] = true;

  // Drop the reactions this BI provoked (pendingTests / attachments / slid).
  pruneProgBiSideEffects(session, actorId, progKey);
  return true;
}

/** Whether a floor is a password floor un-breached for the given arch (blocks
 *  deeper non-GM movement past it). */
function isBlockingPasswordFloor(session, archId, floor) {
  if (!floor || floor.kind !== "password") return false;
  const fx = (session.floorState || {})[floorKey(archId, floor.id)];
  return !(fx && fx.breached);
}

/** Get (seeding lazily from DEMONS[type]) a demon's NET-action counter. Returns
 *  { value, max } stored on session.demonState, or null if the type is unknown. */
function ensureDemonState(session, actorId) {
  session.demonState = session.demonState || {};
  if (session.demonState[actorId]) return session.demonState[actorId];
  const actor = game.actors?.get(actorId);
  const type = bridge.getDemonType(actor);
  const max = type ? (DEMONS[type]?.actions ?? 0) : (actor?.system?.stats?.actions ?? 0);
  if (!max) return null;
  session.demonState[actorId] = { value: max, max };
  return session.demonState[actorId];
}

/** Server-side gate for derezzing a TRAP Black-ICE program: only when the owner
 *  runner stands on the same floor as the trap (SPEC §14.12). Enforcement of the
 *  actual derez runs client-side (owner's own item), so the UI calls this first.
 *  Exported for G2. Returns true when the derez is permitted. */
export function canDerezTrap(session, pid, programId) {
  const ps = (session?.progState || {})[`${pid}|${programId}`];
  if (!ps || ps.mode !== "trap") return true; // not a trap → normal derez rules.
  const part = (session?.participants || {})[pid];
  if (!part) return false;
  return (part.floorIndex || 0) === (Number(ps.floorIndex) || 0);
}

/** The set of ICE def ids across all archs backed by the given actorId. Used to
 *  drop attachments when an ICE actor is derezzed (attachments key on def id). */
function iceDefIdsForActor(actorId) {
  const out = new Set();
  const archs = getWorld("netArchs") || {};
  for (const arch of Object.values(archs)) {
    for (const floor of arch.floors || []) {
      for (const i of floor.ice || []) if (i.actorId === actorId) out.add(i.id);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Turn queue (core Foundry Combat API — no CPR internals)              */
/* ------------------------------------------------------------------ */

/** Move an actor's combatant to the top of the active combat's turn queue by
 *  giving it initiative EQUAL to the current highest (SPEC §14.1 — "above the
 *  current top" without out-running everyone by +1). A `queueTs` flag is stamped
 *  on the combatant so main.js's `_sortCombatants` patch tie-breaks newest-first.
 *  Creates an actorId-only combatant if one does not already exist (legal in
 *  v12 — name/img fall back to the actor). Returns true on success, false if
 *  there is no active combat (caller emits the no-combat hint). */
export async function moveToTopOfQueue(actorId) {
  // No active combat → CREATE one (user requirement: an ICE encounter must
  // initialize the fight so the queue mechanics work out of the box).
  let combat = game.combat;
  if (!combat) {
    try {
      combat = await Combat.create({ scene: canvas?.scene?.id ?? null, active: true });
    } catch (e) {
      console.error(`${MODULE_ID} | failed to create combat`, e);
      return false;
    }
  }
  if (!combat) return false;
  let c = combat.combatants.find((x) => x.actorId === actorId);
  if (!c) {
    const created = await combat.createEmbeddedDocuments("Combatant", [{ actorId }]);
    c = created?.[0];
  }
  if (!c) return false;
  // The current highest initiative among the others; fall back to the first
  // combatant's initiative, else 0. We match it exactly (equal-init insertion).
  const others = combat.combatants.filter((x) => x.id !== c.id);
  const inits = others.map((x) => x.initiative).filter((v) => typeof v === "number");
  const topInit = inits.length
    ? Math.max(...inits)
    : (others[0]?.initiative ?? combat.combatants.contents[0]?.initiative ?? 0);
  // Stamp queueTs first (drives the tie-break), then set the equal initiative.
  await c.setFlag(MODULE_ID, "queueTs", Date.now());
  await combat.setInitiative(c.id, topInit);
  return true;
}

/** Post a localized chat card. `whisperGM` sends it only to GM users. */
function postChatCard(title, body, { whisperGM = false } = {}) {
  const content =
    `<div class="crns-chat-card"><div class="crns-chat-title">` +
    `<i class="fas fa-shield-halved"></i> ${escHtml(title)}</div>` +
    `<div class="crns-chat-body">${escHtml(body)}</div></div>`;
  const msg = { user: game.user.id, content };
  if (whisperGM) msg.whisper = game.users.filter((u) => u.isGM).map((u) => u.id);
  return ChatMessage.create(msg);
}

/** Post the "«name» takes N damage" chat card for a damaged target (any kind:
 *  ICE / demon / prog-BI / runner). Target naming is resolved by the caller so
 *  the card always names the RIGHT entity. */
function postDamageCard(name, amount) {
  return postChatCard(
    loc("CRNS.Chat.DamageTitle"),
    loc("CRNS.Chat.TookDamage", { name, n: Number(amount) || 0 }),
  );
}

/** Post the "«name» destroyed/derezzed" chat card when a target's REZ hits 0. */
function postDestroyedCard(name) {
  return postChatCard(loc("CRNS.Chat.DestroyedTitle"), loc("CRNS.Chat.Destroyed", { name }));
}

/** Minimal HTML escape (data.js does not import esc from constants). */
function escHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** All backing actorIds of alive Black ICE on a floor (rez.value > 0). */
function aliveIceOnFloor(floor) {
  const out = [];
  for (const def of floor?.ice || []) {
    if (!def.actorId) continue;
    const actor = game.actors?.get(def.actorId);
    const rez = actor?.system?.stats?.rez?.value ?? 0;
    if (rez > 0) out.push({ def, actor });
  }
  return out;
}

/** Player-placed TRAP Black ICE sitting on a given floor of an arch, backed by a
 *  live actor (rez > 0). Player traps behave like architecture ICE toward OTHER
 *  runners (Addendum 2). Returns { progKey, ownerPid, programId, actorId, actor }. */
function aliveTrapProgsOnFloor(session, archId, floorIndex) {
  const out = [];
  const ps = session.progState || {};
  for (const [key, st] of Object.entries(ps)) {
    if (!st || st.mode !== "trap" || !st.actorId) continue;
    if (Number(st.floorIndex) !== Number(floorIndex)) continue;
    // key = "<ownerPid>|<programId>"; ownerPid may contain "|"? No — pids never
    // contain "|" (see runnerPid). Split on the LAST "|".
    const cut = key.lastIndexOf("|");
    if (cut < 0) continue;
    const ownerPid = key.slice(0, cut);
    const programId = key.slice(cut + 1);
    // The trap belongs to this arch only if its owner is connected to it.
    const owner = (session.participants || {})[ownerPid];
    if (!owner || owner.archId !== archId) continue;
    const actor = game.actors?.get(st.actorId);
    const rez = actor?.system?.stats?.rez?.value ?? 0;
    if (rez <= 0) continue;
    out.push({ progKey: key, ownerPid, programId, actorId: st.actorId, actor });
  }
  return out;
}

/** Trigger a Black ICE "attack of opportunity" SPEED test when a runner ENTERS a
 *  floor (Corebook p.205). For each alive Black ICE on the destination floor with
 *  no existing pending test for this pid+iceRef: register the test, bump the ICE
 *  to the top of the combat queue, and post an encounter chat card. Mutates
 *  `session` in place; returns true if it changed. GM-side only. */
async function triggerFloorIce(session, archId, pid) {
  const part = (session.participants || {})[pid];
  if (!part || part.kind !== "runner" || part.archId !== archId) return false;
  const arch = (getWorld("netArchs") || {})[archId];
  const floor = (arch?.floors || [])[part.floorIndex || 0];
  if (!floor) return false;

  session.pendingTests = session.pendingTests || [];
  session.attachments = session.attachments || [];
  session.slid = session.slid || [];
  let changed = false;
  let queuedAny = false;

  // Does the runner belong to a non-GM player? Only then do ICE auto-attach.
  const runnerUser = part.userId ? game.users.get(part.userId) : null;
  const playerRunner = !!part.userId && !!runnerUser && !runnerUser.isGM;

  const queuedActorIds = [];
  for (const { def, actor } of aliveIceOnFloor(floor)) {
    const programTargets = activeProgramRefs(session, pid, actor);
    const antiProgram = isAntiProgram(actor, def.type);
    if (antiProgram && !programTargets.length) continue;
    // Skip ICE ALREADY ATTACHED to THIS runner: the attack-of-opportunity happens
    // once, at first contact. Attached ICE move together with the runner (follow
    // logic), so without this every step would re-provoke them. Slid ICE and ICE
    // attached to OTHER runners are unaffected (they may legitimately trigger).
    const alreadyAttached = (session.attachments || [])
      .some((a) => a.archId === archId && a.iceId === def.id && a.pid === pid);
    if (alreadyAttached) continue;

    const ref = `ice:${archId}:${floor.id}:${def.id}`;
    const exists = session.pendingTests.some((t) => t.pid === pid && t.ref === ref);
    if (!exists) {
      session.pendingTests.push({
        id: uid("st"),
        pid,
        ref,
        iceActorId: def.actorId,
        iceName: actor?.name || def.type,
        targetRef: antiProgram ? programTargets[Math.floor(Math.random() * programTargets.length)] : `runner:${pid}`,
        antiProgram,
        ts: Date.now(),
      });
      changed = true;
      const queued = await moveToTopOfQueue(def.actorId);
      if (queued) { queuedAny = true; queuedActorIds.push(def.actorId); }
      postChatCard(actor?.name || def.type, loc("CRNS.Chat.IceReacts", { name: actor?.name || def.type }));
    }

    // Auto-attach the ICE to a player's runner (SPEC §14.11): follow enabled on
    // the actor (default true), not already slid past by this pid, and not
    // already attached to this pid.
    if (playerRunner || antiProgram) {
      const follow = actor?.getFlag?.(MODULE_ID, "follow");
      if (follow === false) continue;
      const isSlid = session.slid.some((s) => s.archId === archId && s.iceId === def.id && s.pid === pid);
      if (isSlid) continue;
      const already = session.attachments.some((a) => a.archId === archId && a.iceId === def.id && a.pid === pid);
      if (!already) {
        session.attachments.push({ archId, iceId: def.id, pid });
        changed = true;
      }
    }
  }

  // Player-placed TRAP Black ICE reacts to OTHER runners just like arch ICE
  // (Addendum 2). Skip a trap owned by the moving runner itself.
  for (const trap of aliveTrapProgsOnFloor(session, archId, part.floorIndex || 0)) {
    if (trap.ownerPid === pid) continue;
    const programTargets = activeProgramRefs(session, pid, trap.actor);
    const antiProgram = isAntiProgram(trap.actor);
    if (antiProgram && !programTargets.length) continue;
    const iceName = trap.actor?.name || loc("CRNS.Actions.KindIce");
    const ref = `prog:${trap.progKey.replace("|", ":")}`; // prog:<ownerPid>:<programId>
    const alreadyAttachedProg = session.attachments
      .some((a) => a.archId === archId && a.progKey === trap.progKey && a.pid === pid);
    if (alreadyAttachedProg) continue;

    const exists = session.pendingTests.some((t) => t.pid === pid && t.ref === ref);
    if (!exists) {
      session.pendingTests.push({
        id: uid("st"), pid, ref,
        iceActorId: trap.actorId, iceName, ts: Date.now(),
        targetRef: antiProgram ? programTargets[Math.floor(Math.random() * programTargets.length)] : `runner:${pid}`,
        antiProgram,
      });
      changed = true;
      const queued = await moveToTopOfQueue(trap.actorId);
      if (queued) { queuedAny = true; queuedActorIds.push(trap.actorId); }
      postChatCard(iceName, loc("CRNS.Chat.IceReacts", { name: iceName }));
    }

    // Chase-on-trigger: the trap leaves "lying in wait" and CHASES the runner
    // that triggered it ("They do not move, unless chasing a target that
    // triggered them") — ANY runner, player or GM-run NPC alike.
    const isSlid = session.slid.some((s) => s.archId === archId && s.progKey === trap.progKey && s.pid === pid);
    if (isSlid) continue;
    session.attachments.push({ archId, progKey: trap.progKey, pid });
    changed = true;
  }

  // If tests were registered but there is no combat, whisper the GM a hint once.
  // (moveToTopOfQueue now auto-creates the combat, so this is a rare failure path.)
  if (changed && !queuedAny && !game.combat) {
    postChatCard(loc("CRNS.Chat.TurnQueue"), loc("CRNS.Chat.NoCombat"), { whisperGM: true });
  }

  // An encounter happened: bootstrap the combat around the encountering runner.
  if (queuedAny && game.combat) {
    await bootstrapRunnerCombat(part, queuedActorIds);
  }
  return changed;
}

/** Ensure a runner participant is a combatant of the active combat with a ROLLED
 *  initiative (1d10 + REF, public roll — the CPR tracker's own die crashes on
 *  tokenless combatants: cpr-combat.js destructures combatant.token). Then
 *  re-bump the just-queued ICE so their equal-top initiative is computed against
 *  the fresh runner roll (otherwise they'd display 0 in an empty queue), and
 *  start the combat so turn-based mechanics (NET-action resets) run. */
async function bootstrapRunnerCombat(part, requeueActorIds = []) {
  const combat = game.combat;
  if (!combat) return;
  try {
    const runnerActor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
    if (runnerActor) {
      let c = combat.combatants.find((x) => x.actorId === runnerActor.id);
      if (!c) {
        const created = await combat.createEmbeddedDocuments("Combatant", [{ actorId: runnerActor.id }]);
        c = created?.[0];
      }
      if (c && (c.initiative === null || c.initiative === undefined)) {
        const ref = Number(runnerActor.system?.stats?.ref?.value ?? 0);
        const roll = new Roll(`1d10 + ${ref}`);
        await roll.evaluate();
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: runnerActor }),
          flavor: loc("CRNS.Chat.Initiative"),
        });
        await combat.setInitiative(c.id, roll.total);
        // Re-bump the freshly queued ICE above the runner's rolled initiative.
        for (const aid of requeueActorIds) await moveToTopOfQueue(aid);
      }
    }
    if (!combat.started) await combat.startCombat();
  } catch (e) {
    console.error(`${MODULE_ID} | combat bootstrap`, e);
  }
}

/** Drop pending tests matching a predicate. Returns true if any were removed. */
function prunePendingTests(session, predicate) {
  const list = session.pendingTests;
  if (!Array.isArray(list) || !list.length) return false;
  const kept = list.filter((t) => !predicate(t));
  if (kept.length === list.length) return false;
  session.pendingTests = kept;
  return true;
}

/* ------------------------------------------------------------------ */
/* Phase B helpers (tree / arch reconciliation)                         */
/* ------------------------------------------------------------------ */

/** Node lookup in a flat tree array. */
function findNode(tree, nodeId) {
  return tree.find((n) => n.id === nodeId) ?? null;
}

/** All descendant node ids of a folder (excluding the folder itself). */
function descendantIds(tree, nodeId) {
  const out = [];
  const stack = tree.filter((n) => n.parentId === nodeId).map((n) => n.id);
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    for (const c of tree.filter((n) => n.parentId === id)) stack.push(c.id);
  }
  return out;
}

/** Would reparenting nodeId under parentId create a cycle? */
function wouldCycle(tree, nodeId, parentId) {
  if (parentId === "") return false;
  if (parentId === nodeId) return true;
  let cur = findNode(tree, parentId);
  const seen = new Set();
  while (cur && cur.parentId) {
    if (cur.parentId === nodeId) return true;
    if (seen.has(cur.parentId)) break;
    seen.add(cur.parentId);
    cur = findNode(tree, cur.parentId);
  }
  return false;
}

/** Every actorId backing an ICE or Demon anywhere in an arch. */
function archActorIds(arch) {
  const ids = [];
  for (const floor of arch?.floors || []) {
    for (const i of floor.ice || []) if (i.actorId) ids.push(i.actorId);
    if (floor.demon?.actorId) ids.push(floor.demon.actorId);
  }
  return ids;
}

/** A fresh default floor. */
function defaultFloor() {
  return { id: uid("f"), kind: "password", label: "", dv: 6, description: "", ice: [], demon: null };
}

/** Validate arch caps (server-side). Returns an error key or null. */
function validateArchCaps(arch) {
  const floors = arch?.floors || [];
  if (!floors.length) return "CRNS.Errors.MinFloor";
  const topologyError = topology(arch).error;
  if (topologyError) return topologyError;
  let demonCount = 0;
  for (const floor of floors) {
    const ice = floor.ice || [];
    if (ice.length > MAX_ICE_PER_FLOOR) return "CRNS.Errors.TooManyIce";
    for (const i of ice) if (!BLACK_ICE[i.type] && !bridge.archContent?.(i, "blackIce")) return "CRNS.Errors.UnknownIce";
    if (floor.demon) {
      if (!DEMONS[floor.demon.type] && !bridge.archContent?.(floor.demon, "demon")) return "CRNS.Errors.UnknownDemon";
      demonCount += 1;
    }
  }
  if (demonCount > maxDemons(floors.length)) return "CRNS.Errors.TooManyDemons";
  return null;
}

/** Disconnect (or drop) every participant currently in the given arch, pruning
 *  any pending SPEED tests belonging to those participants. Async: it deletes the
 *  backing prog-ICE actors (SPEC §14.12 / Task 1) of disconnected runners. */
async function disconnectArchParticipants(session, archId) {
  const parts = session.participants || {};
  const affected = new Set();
  const progActorIds = [];
  for (const [pid, p] of Object.entries(parts)) {
    if (p.archId !== archId) continue;
    clearRunnerReferences(session, pid);
    affected.add(pid);
    if (p.kind === "spectator") delete parts[pid];
    else {
      p.archId = ""; p.floorIndex = 0; p.jackedIn = false; p.maxFloor = 0; p.visitedFloorIds = [];
      progActorIds.push(...progActorIdsForPid(session, pid));
      clearProgFloors(session, pid);
      clearProgState(session, pid);
      if (session.reveal && session.reveal[pid]) delete session.reveal[pid];
    }
  }
  if (progActorIds.length) await bridge.deleteEntityActors(progActorIds);
  if (affected.size) {
    prunePendingTests(session, (t) => affected.has(t.pid));
    pruneAttachments(session, (a) => affected.has(a.pid) || a.archId === archId);
  }
}

/** Delete every progFloors override belonging to a participant (called wherever
 *  that participant's rezzed mirror is cleared). Returns true if it changed. */
function clearProgFloors(session, pid) {
  const pf = session.progFloors;
  if (!pf) return false;
  let changed = false;
  const prefix = `${pid}|`;
  for (const key of Object.keys(pf)) {
    if (key.startsWith(prefix)) { delete pf[key]; changed = true; }
  }
  return changed;
}

/** Clear a participant's destroyed-program lockout entries (§10). `pid` null
 *  clears ALL of them (GM "restore programs" button). Returns true if changed. */
function clearDestroyed(session, pid = null) {
  const d = session.destroyed;
  if (!d) return false;
  let changed = false;
  if (pid === null) {
    if (Object.keys(d).length) { session.destroyed = {}; changed = true; }
    return changed;
  }
  const prefix = `${pid}|`;
  for (const key of Object.keys(d)) {
    if (key.startsWith(prefix)) { delete d[key]; changed = true; }
  }
  return changed;
}

/** Remove an arch from the open-tabs list, fixing activeTab. */
function closeArchTab(session, archId) {
  session.tabs = (session.tabs || []).filter((t) => t !== archId);
  if (session.activeTab === archId) session.activeTab = session.tabs[0] ?? "";
}

/** Reconcile actors for arch.update: create actors for new defs, delete removed
 *  ones, mutating `newArch` in place so defs carry their actorId. */
async function reconcileArchActors(oldArch, newArch) {
  const oldIds = new Set(archActorIds(oldArch));
  const keptIds = new Set();
  const archName = newArch.name;

  for (const floor of newArch.floors || []) {
    const ice = floor.ice || [];
    for (const def of ice) {
      if (oldIds.has(def.actorId) && game.actors?.get(def.actorId)) { keptIds.add(def.actorId); continue; }
      const content = bridge.archContent?.(def, "blackIce");
      if (content) def.content = content;
      const actorId = await bridge.createIceActor(def.type, archName, content);
      def.actorId = actorId || "";
      if (actorId) keptIds.add(actorId);
    }
    if (floor.demon) {
      const def = floor.demon;
      if (oldIds.has(def.actorId) && game.actors?.get(def.actorId)) { keptIds.add(def.actorId); }
      else {
        const content = bridge.archContent?.(def, "demon");
        if (content) def.content = content;
        const actorId = await bridge.createDemonActor(def.type, archName, content);
        def.actorId = actorId || "";
        if (actorId) keptIds.add(actorId);
      }
    }
  }
  const removed = [...oldIds].filter((id) => !keptIds.has(id));
  if (removed.length) await bridge.deleteEntityActors(removed);
}

/* OPS: op name -> async handler(payload, userId). Every handler re-validates
 * permissions on the GM side via `userId` — never trust the client.
 *
 * Phase A ships only the `ping` test op. Domain ops arrive in later phases:
 *   Phase B: tree.* / arch.* / tabs.*
 *   Phase C: session.* / ent.*
 *   Phase D: run.*
 */
const OPS = {
  async "content.save"(payload, userId) { return contentOperation("content.save", payload, userId, bridge); },
  async "content.delete"(payload, userId) { return contentOperation("content.delete", payload, userId, bridge); },
  async "content.createDocument"(payload, userId) { return contentOperation("content.createDocument", payload, userId, bridge); },
  /* ---- diagnostics ---- */
  async ping({ echo } = {}, userId) {
    return { pong: true, echo: echo ?? null, gm: requesterIsGM(userId) };
  },

  /* ---- tree ---- (Phase B) */

  async "tree.createFolder"({ parentId = "", name } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("netTree") || [];
    if (parentId && findNode(tree, parentId)?.type !== "folder") return false;
    tree.push({ id: uid("nd"), type: "folder", name: name || loc("CRNS.Tree.NewFolder"), parentId: parentId || "" });
    await setWorld("netTree", tree);
    return true;
  },

  async "tree.createArch"({ parentId = "", name } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("netTree") || [];
    if (parentId && findNode(tree, parentId)?.type !== "folder") return false;
    const archName = name || loc("CRNS.Tree.Untitled");
    const archId = uid("a");
    const archs = getWorld("netArchs") || {};
    archs[archId] = { id: archId, name: archName, floors: [defaultFloor()] };
    tree.push({ id: uid("nd"), type: "arch", name: archName, parentId: parentId || "", archId });
    await setWorld("netArchs", archs);
    await setWorld("netTree", tree);
    return { archId };
  },

  async "tree.rename"({ nodeId, name } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("netTree") || [];
    const node = findNode(tree, nodeId);
    if (!node) return false;
    const newName = (name || "").trim();
    if (!newName) return false;
    node.name = newName;
    if (node.type === "arch" && node.archId) {
      const archs = getWorld("netArchs") || {};
      const arch = archs[node.archId];
      if (arch) {
        const oldName = arch.name;
        arch.name = newName;
        await setWorld("netArchs", archs);
        await bridge.renameEntityFolder(oldName, newName);
      }
    }
    await setWorld("netTree", tree);
    return true;
  },

  async "tree.delete"({ nodeId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    let tree = getWorld("netTree") || [];
    const node = findNode(tree, nodeId);
    if (!node) return false;
    const toRemove = [nodeId, ...descendantIds(tree, nodeId)];
    const removeSet = new Set(toRemove);
    const archs = getWorld("netArchs") || {};
    let session = getWorld("session") || {};

    const removedArchIds = new Set();
    for (const id of toRemove) {
      const n = findNode(tree, id);
      if (n?.type === "arch" && n.archId && archs[n.archId]) {
        const arch = archs[n.archId];
        // Disconnect participants first so their backing prog-ICE actors are
        // deleted before the arch folder is removed (SPEC §14.12 / Task 1).
        await disconnectArchParticipants(session, n.archId);
        await bridge.deleteEntityActors(archActorIds(arch));
        await bridge.deleteEntityFolder(arch.name);
        closeArchTab(session, n.archId);
        removedArchIds.add(n.archId);
        delete archs[n.archId];
      }
    }
    // Prune session targets that referenced any deleted arch's ice/demon.
    for (const [uid_, ref] of Object.entries(session.targets || {})) {
      const [kind, refArchId] = (ref || "").split(":");
      if ((kind === "ice" || kind === "demon") && removedArchIds.has(refArchId)) {
        delete session.targets[uid_];
      }
    }
    // Prune pending SPEED tests whose ICE lived in a deleted arch.
    prunePendingTests(session, (t) => removedArchIds.has((t.ref || "").split(":")[1]));
    // Prune round-2 state referencing any deleted arch.
    pruneAttachments(session, (a) => removedArchIds.has(a.archId));
    session.slid = (session.slid || []).filter((s) => !removedArchIds.has(s.archId));
    if (session.floorState) {
      for (const key of Object.keys(session.floorState)) {
        if (removedArchIds.has(key.split(":")[0])) delete session.floorState[key];
      }
    }
    if (session.cloaks) {
      for (const aId of Object.keys(session.cloaks)) if (removedArchIds.has(aId)) delete session.cloaks[aId];
    }
    if (session.reveal) {
      for (const rp of Object.values(session.reveal)) {
        for (const aId of Object.keys(rp)) if (removedArchIds.has(aId)) delete rp[aId];
      }
    }
    tree = tree.filter((n) => !removeSet.has(n.id));

    await setWorld("netArchs", archs);
    await setWorld("session", session);
    await setWorld("netTree", tree);
    return true;
  },

  async "tree.toggle"({ nodeId, open } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const state = getWorld("treeState") || {};
    if (open) state[nodeId] = true; else delete state[nodeId];
    await setWorld("treeState", state);
    return true;
  },

  async "tree.move"({ nodeId, parentId = "" } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("netTree") || [];
    const node = findNode(tree, nodeId);
    if (!node) return false;
    const target = parentId ? findNode(tree, parentId) : null;
    if (parentId && (!target || target.type !== "folder")) return false;
    if (wouldCycle(tree, nodeId, parentId)) return { error: "CRNS.Errors.Cycle" };
    node.parentId = parentId || "";
    await setWorld("netTree", tree);
    return true;
  },

  /* ---- arch ---- (Phase B) */

  async "arch.update"({ archId, arch } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const archs = getWorld("netArchs") || {};
    const oldArch = archs[archId];
    if (!oldArch || !arch) return false;
    const capErr = validateArchCaps(arch);
    if (capErr) return { error: capErr };

    const newArch = foundry.utils.deepClone(arch);
    newArch.id = archId;
    if (!newArch.name) newArch.name = oldArch.name;

    // If the arch was renamed via the editor, rename the actor folder too.
    if (newArch.name !== oldArch.name) await bridge.renameEntityFolder(oldArch.name, newArch.name);

    await reconcileArchActors(oldArch, newArch);

    archs[archId] = newArch;
    await setWorld("netArchs", archs);

    // Preserve live positions and fog by floor identity, not display order.
    const session = getWorld("session") || {};
    const floors = newArch.floors || [];
    const floorById = new Set(floors.map((f) => f.id));
    let sessionChanged = false;

    const oldFloors = oldArch.floors || [];
    const oldGraph = topology(oldArch);
    const entryIndex = topology(newArch).parents.indexOf(null);
    const remapIndex = (index) => {
      let oldIndex = Number(index) || 0;
      while (oldFloors[oldIndex]) {
        const next = floors.findIndex((f) => f.id === oldFloors[oldIndex].id);
        if (next >= 0) return next;
        if (oldGraph.parents[oldIndex] === null || oldGraph.error) break;
        oldIndex = oldGraph.parents[oldIndex];
      }
      return entryIndex;
    };
    const legacy = oldFloors.every((f) => !Object.hasOwn(f, "parentId"));
    for (const p of Object.values(session.participants || {})) {
      if (p.archId !== archId) continue;
      const visited = Array.isArray(p.visitedFloorIds) ? p.visitedFloorIds : [];
      const oldVisited = legacy ? oldFloors.filter((f, i) => i <= Math.max(Number(p.maxFloor) || 0, Number(p.floorIndex) || 0)).map((f) => f.id) : [];
      p.floorIndex = remapIndex(p.floorIndex);
      p.visitedFloorIds = [...new Set([...visited, ...oldVisited, floors[p.floorIndex].id])].filter((id) => floorById.has(id));
      p.maxFloor = Math.max(...p.visitedFloorIds.map((id) => floors.findIndex((f) => f.id === id)));
      sessionChanged = true;
    }
    for (const rp of Object.values(session.reveal || {})) {
      if (!Object.hasOwn(rp, archId)) continue;
      const reveal = rp[archId];
      const ids = Array.isArray(reveal) ? reveal : legacy && Number.isFinite(reveal)
        ? oldFloors.filter((f, i) => i <= reveal).map((f) => f.id) : [];
      rp[archId] = ids.filter((id) => floorById.has(id));
      sessionChanged = true;
    }
    for (const [key, st] of Object.entries(session.progState || {})) {
      const ownerPid = key.slice(0, key.lastIndexOf("|"));
      if (session.participants?.[ownerPid]?.archId !== archId) continue;
      st.floorIndex = remapIndex(st.floorIndex);
      sessionChanged = true;
    }
    for (const key of Object.keys(session.progFloors || {})) {
      const ownerPid = key.slice(0, key.lastIndexOf("|"));
      if (session.participants?.[ownerPid]?.archId !== archId) continue;
      session.progFloors[key] = remapIndex(session.progFloors[key]);
      sessionChanged = true;
    }

    for (const [uid_, ref] of Object.entries(session.targets || {})) {
      const [kind, refArchId, floorId, entId] = (ref || "").split(":");
      if ((kind !== "ice" && kind !== "demon") || refArchId !== archId) continue;
      // Verify the floor + entity + backing actor still exist in the new arch.
      let ok = floorById.has(floorId);
      if (ok) {
        const floor = floors.find((f) => f.id === floorId);
        const def = kind === "ice"
          ? (floor.ice || []).find((i) => i.id === entId)
          : (floor.demon && floor.demon.id === entId ? floor.demon : null);
        ok = !!def?.actorId;
      }
      if (!ok) { delete session.targets[uid_]; sessionChanged = true; }
    }

    // Drop pending SPEED tests whose ICE floor/def no longer exists in this arch.
    if (prunePendingTests(session, (t) => {
      const [, tArch, tFloor, tEnt] = (t.ref || "").split(":");
      if (tArch !== archId) return false;
      const floor = floors.find((f) => f.id === tFloor);
      const def = floor && (floor.ice || []).find((i) => i.id === tEnt && i.actorId);
      return !def;
    })) sessionChanged = true;

    // Prune round-2 state against the new floor/ice set.
    const liveIceIds = new Set();
    for (const f of floors) for (const i of f.ice || []) if (i.id) liveIceIds.add(i.id);
    const liveReaction = (a) => a.progKey ? !!session.progState?.[a.progKey] : liveIceIds.has(a.iceId);
    if (pruneAttachments(session, (a) => a.archId === archId && !liveReaction(a))) sessionChanged = true;
    const slidBefore = (session.slid || []).length;
    session.slid = (session.slid || []).filter((s) => s.archId !== archId || liveReaction(s));
    if (session.slid.length !== slidBefore) sessionChanged = true;
    if (session.floorState) {
      for (const key of Object.keys(session.floorState)) {
        const [kArch, kFloor] = key.split(":");
        if (kArch === archId && !floorById.has(kFloor)) {
          delete session.floorState[key];
          sessionChanged = true;
        }
      }
    }

    if (sessionChanged) await setWorld("session", session);

    // Keep the tree node name in sync with an in-editor rename.
    const tree = getWorld("netTree") || [];
    const node = tree.find((n) => n.type === "arch" && n.archId === archId);
    if (node && node.name !== newArch.name) {
      node.name = newArch.name;
      await setWorld("netTree", tree);
    }
    return true;
  },

  async "arch.duplicate"({ archId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const archs = getWorld("netArchs") || {};
    const src = archs[archId];
    if (!src) return false;
    const topologyError = topology(src).error;
    if (topologyError) return { error: topologyError };
    const tree = getWorld("netTree") || [];
    const srcNode = tree.find((n) => n.type === "arch" && n.archId === archId);

    const newId = uid("a");
    const newName = `${src.name} ${loc("CRNS.Tree.CopySuffix")}`;
    const copy = { id: newId, name: newName, floors: [] };
    const floorIds = new Map(src.floors.map((f) => [f.id, uid("f")]));

    for (const floor of src.floors || []) {
      const nf = {
        id: floorIds.get(floor.id), kind: floor.kind, label: floor.label || "",
        dv: floor.dv, description: floor.description || "", ice: [], demon: null,
      };
      if (Object.hasOwn(floor, "parentId")) nf.parentId = floor.parentId === "" ? "" : floorIds.get(floor.parentId);
      for (const i of floor.ice || []) {
        const actorId = i.actorId ? await bridge.duplicateEntityActor(i.actorId, newName) : "";
        nf.ice.push({ id: uid("i"), type: i.type, actorId: actorId || "", ...(i.content ? { content: i.content } : {}) });
      }
      if (floor.demon) {
        const actorId = floor.demon.actorId ? await bridge.duplicateEntityActor(floor.demon.actorId, newName) : "";
        nf.demon = { id: uid("d"), type: floor.demon.type, actorId: actorId || "", ...(floor.demon.content ? { content: floor.demon.content } : {}) };
      }
      copy.floors.push(nf);
    }

    archs[newId] = copy;
    tree.push({ id: uid("nd"), type: "arch", name: newName, parentId: srcNode?.parentId ?? "", archId: newId });
    await setWorld("netArchs", archs);
    await setWorld("netTree", tree);
    return { archId: newId };
  },

  async "arch.import"({ parentId = "", arch } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("netTree") || [];
    if (parentId && findNode(tree, parentId)?.type !== "folder") return false;
    if (!arch || !Array.isArray(arch.floors)) return { error: "CRNS.Errors.BadImport" };
    const topologyError = topology(arch).error;
    if (topologyError) return { error: topologyError };

    const newId = uid("a");
    const newName = (typeof arch.name === "string" && arch.name.trim()) || loc("CRNS.Tree.Untitled");
    const clean = { id: newId, name: newName, floors: [] };
    const floorIds = new Map(arch.floors.map((f) => [f.id, uid("f")]));

    for (const floor of arch.floors) {
      const kind = FLOOR_KINDS_SET.has(floor?.kind) ? floor.kind : "custom";
      const nf = {
        id: floorIds.get(floor.id), kind, label: typeof floor?.label === "string" ? floor.label : "",
        dv: Number.isFinite(Number(floor?.dv)) ? Number(floor.dv) : 0,
        description: typeof floor?.description === "string" ? floor.description : "",
        ice: [], demon: null,
      };
      if (Object.hasOwn(floor, "parentId")) nf.parentId = floor.parentId === "" ? "" : floorIds.get(floor.parentId);
      const srcIce = Array.isArray(floor?.ice) ? floor.ice.slice(0, MAX_ICE_PER_FLOOR) : [];
      for (const i of srcIce) {
        const content = bridge.archContent?.(i, "blackIce");
        if (!BLACK_ICE[i?.type] && !content) continue;
        nf.ice.push({ id: uid("i"), type: i.type, actorId: "", ...(content ? { content } : {}) });
      }
      if (floor?.demon && (DEMONS[floor.demon.type] || bridge.archContent?.(floor.demon, "demon"))) {
        const content = bridge.archContent?.(floor.demon, "demon");
        nf.demon = { id: uid("d"), type: floor.demon.type, actorId: "", ...(content ? { content } : {}) };
      }
      clean.floors.push(nf);
    }
    const capErr = validateArchCaps(clean);
    if (capErr) return { error: capErr };
    await reconcileArchActors(null, clean);
    for (const [index, floor] of clean.floors.entries()) {
      const source = arch.floors[index];
      const srcIce = (Array.isArray(source.ice) ? source.ice.slice(0, MAX_ICE_PER_FLOOR) : []).filter((i) => BLACK_ICE[i?.type] || bridge.archContent?.(i, "blackIce"));
      for (const [i, def] of floor.ice.entries()) {
        if (def.actorId && srcIce[i].actorData) await bridge.applyActorOverrides(def.actorId, srcIce[i].actorData);
      }
      if (floor.demon?.actorId && source.demon?.actorData) await bridge.applyActorOverrides(floor.demon.actorId, source.demon.actorData);
    }

    const archs = getWorld("netArchs") || {};
    archs[newId] = clean;
    tree.push({ id: uid("nd"), type: "arch", name: newName, parentId: parentId || "", archId: newId });
    await setWorld("netArchs", archs);
    await setWorld("netTree", tree);
    return { archId: newId };
  },

  /* ---- tabs ---- (Phase B) */

  async "tabs.open"({ archId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const archs = getWorld("netArchs") || {};
    if (!archs[archId]) return false;
    const session = getWorld("session") || {};
    session.tabs = session.tabs || [];
    if (!session.tabs.includes(archId)) session.tabs.push(archId);
    session.activeTab = archId;
    await setWorld("session", session);
    return true;
  },

  async "tabs.close"({ archId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const session = getWorld("session") || {};
    await disconnectArchParticipants(session, archId);
    closeArchTab(session, archId);
    await setWorld("session", session);
    return true;
  },

  async "tabs.activate"({ archId } = {}, userId) {
    if (!requesterIsGM(userId)) return false;
    const session = getWorld("session") || {};
    session.tabs = session.tabs || [];
    if (!session.tabs.includes(archId)) return false;
    session.activeTab = archId;
    await setWorld("session", session);
    return true;
  },

  /* ---- session ---- (Phase C) */

  async "session.documentDeleted"({ actorId, actorUuid, programId } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    if (actorId) {
      if (typeof actorId !== "string" || actorUuid || programId || game.actors?.get(actorId)) return false;
      const uuid = `Actor.${actorId}`;
      for (const [pid, part] of Object.entries(session.participants || {})) {
        if (part.actorUuid !== uuid) continue;
        const programRefs = new Set(Object.keys(session.progState || {}).filter(key => key.startsWith(`${pid}|`))
          .map(key => `prog:${key.replace("|", ":")}`));
        pruneDeletedRefs(session, programRefs);
        clearRunnerReferences(session, pid);
        await deleteProgActors(session, pid);
        clearProgState(session, pid);
        clearProgFloors(session, pid);
        clearDestroyed(session, pid);
        for (const key of Object.keys(session.defeated || {})) if (key.startsWith(`${pid}|`)) delete session.defeated[key];
        if (session.reveal) delete session.reveal[pid];
        if (session.equipment) delete session.equipment[pid];
        delete session.participants[pid];
      }
      if (session.programUsage) delete session.programUsage[uuid];
      for (const [key, state] of Object.entries(session.progState || {})) {
        if (state.actorId !== actorId) continue;
        const cut = key.lastIndexOf("|");
        if (!await clearDeletedProgram(session, key.slice(0, cut), key.slice(cut + 1), { derez: true })) return false;
      }
      const archs = getWorld("netArchs") || {};
      const refs = new Set(), iceIds = new Set();
      let archChanged = false;
      for (const [archId, arch] of Object.entries(archs)) {
        for (const floor of arch.floors || []) {
          const removed = (floor.ice || []).filter(def => def.actorId === actorId);
          for (const def of removed) { refs.add(`ice:${archId}:${floor.id}:${def.id}`); iceIds.add(`${archId}|${def.id}`); }
          if (removed.length) { floor.ice = floor.ice.filter(def => def.actorId !== actorId); archChanged = true; }
          if (floor.demon?.actorId === actorId) {
            refs.add(`demon:${archId}:${floor.id}:${floor.demon.id}`);
            floor.demon = null; archChanged = true;
          }
        }
      }
      pruneDeletedRefs(session, refs);
      prunePendingTests(session, test => test.iceActorId === actorId);
      pruneAttachments(session, attachment => iceIds.has(`${attachment.archId}|${attachment.iceId}`));
      session.slid = (session.slid || []).filter(slide => !iceIds.has(`${slide.archId}|${slide.iceId}`));
      if (session.demonState) delete session.demonState[actorId];
      if (session.demonPrograms) delete session.demonPrograms[actorId];
      if (archChanged) await setWorld("netArchs", archs);
    } else {
      if (typeof actorUuid !== "string" || !actorUuid || typeof programId !== "string" || !programId) return false;
      const owner = fromUuidSync(actorUuid);
      if (!owner || owner.getOwnedItem?.(programId) || owner.items?.get?.(programId)) return false;
      for (const [pid, part] of Object.entries(session.participants || {})) {
        if (part.actorUuid === actorUuid) await clearDeletedProgram(session, pid, programId, { forgetUsage: true });
      }
    }
    await setWorld("session", session);
    return true;
  },

  async "session.connect"({ pid, actorUuid, userId = "", archId = "" } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    session.participants = session.participants || {};

    // Resolve the actor to recompute the NET-action maximum from Interface rank.
    const actor = actorUuid ? (fromUuidSync?.(actorUuid) ?? null) : null;
    const max = actor ? bridge.netActionsMax(bridge.getInterfaceRank(actor)) + netActionBonus(actor) : 2;

    const prev = session.participants[pid] || {};
    const connecting = !!archId; // archId "" → roster only (not jacked in).
    const arch = connecting ? (getWorld("netArchs") || {})[archId] : null;
    const graph = connecting ? topology(arch) : null;
    if (graph?.error) return { error: graph.error };
    const entryIndex = graph ? graph.parents.indexOf(null) : 0;
    const part = {
      kind: "runner",
      userId: userId || prev.userId || "",
      actorUuid: actorUuid || prev.actorUuid || "",
      archId: archId || "",
      floorIndex: connecting ? entryIndex : (prev.floorIndex || 0),
      jackedIn: connecting,
      // On connect, actions reset to max minus 1 (Jack In costs 1 action).
      actions: connecting ? { value: Math.max(0, max - 1), max } : (prev.actions || { value: max, max }),
      rezzed: prev.rezzed || {},
      // Fog-of-war baseline: deepest floor visited (reset to 0 on a fresh connect).
      maxFloor: connecting ? entryIndex : (prev.maxFloor || 0),
      visitedFloorIds: connecting ? [arch.floors[entryIndex].id] : [],
      // One-rez-per-turn allowance (§9) — reset on a fresh connect.
      rezUsedIds: prev.rezUsedIds || {},
      roundSerial: prev.roundSerial || 0,
      turnSerial: prev.turnSerial || 0,
      runUsedIds: connecting && prev.jackedIn === false ? {} : (prev.runUsedIds || {}),
      slideTurn: prev.slideTurn,
      slideCount: prev.slideCount,
      scoutActionSerial: prev.scoutActionSerial || 0,
      lastCombatTurn: prev.lastCombatTurn,
      meatActionTurn: prev.meatActionTurn,
      netActionTurn: prev.netActionTurn,
    };
    session.participants[pid] = part;
    if (connecting && !prev.jackedIn && actor) await onEquipmentJackIn(session, pid, actor, bridge);
    if (connecting && session.reveal?.[pid]) delete session.reveal[pid];
    // Connecting places the runner at the tree entry; provoke Black ICE there.
    if (connecting) await triggerFloorIce(session, archId, pid);
    await setWorld("session", session);
    return true;
  },

  async "session.spectate"({ userId, archId = "", followPid = "" } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants = session.participants || {};
    const isGM = requesterIsGM(callerId);
    if ((!isGM && callerId !== userId) || !game.users.get(userId)) return false;
    const ownSpectators = Object.entries(parts).filter(([, p]) => p.kind === "spectator" && p.userId === userId);
    // Legacy empty-arch requests leave spectating without touching a runner.
    if (!archId) {
      for (const [pid] of ownSpectators) delete parts[pid];
      await setWorld("session", session);
      return true;
    }
    const archs = getWorld("netArchs") || {};
    const activeInArch = (p) => p?.archId === archId && isSpectatableRunner(p, archs);
    if (followPid ? !activeInArch(parts[followPid]) : !Object.values(parts).some(activeInArch)) {
      return { error: "CRNS.Errors.SpectatorUnavailable" };
    }
    if (!isGM) {
      let allow = false, freeMove = false;
      try { allow = !!game.settings.get(MODULE_ID, "allowSpectators"); } catch (e) { /* noop */ }
      try { freeMove = !!game.settings.get(MODULE_ID, "spectatorFreeMove"); } catch (e) { /* noop */ }
      if (!allow) return { error: "CRNS.Errors.SpectatorsDisabled" };
      const current = ownSpectators.find(([, p]) => archs[p.archId] && (p.followPid
        ? parts[p.followPid]?.archId === p.archId && isSpectatableRunner(parts[p.followPid], archs)
        : Object.values(parts).some((r) => r.archId === p.archId && isSpectatableRunner(r, archs))))?.[1];
      if (!freeMove && current?.archId && current.archId !== archId) {
        return { error: "CRNS.Errors.SpectatorSwitchLocked" };
      }
    }

    const pid = ownSpectators[0]?.[0] || (parts[`user:${userId}`] ? uid("watch") : `user:${userId}`);
    for (const [otherPid] of ownSpectators) if (otherPid !== pid) delete parts[otherPid];
    parts[pid] = {
      kind: "spectator",
      userId,
      actorUuid: "",
      archId: archId || "",
      followPid: followPid || "",
      floorIndex: 0,
      jackedIn: false,
    };
    await setWorld("session", session);
    return true;
  },

  async "session.disconnect"({ pid } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part) return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;
    clearRunnerReferences(session, pid);

    if (part.kind === "spectator") delete parts[pid];
    else {
      const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
      if (actor && part.jackedIn !== false) await onEquipmentJackOut(session, pid, actor, bridge, { safe: false });
      part.archId = ""; part.floorIndex = 0; part.jackedIn = false; part.maxFloor = 0; part.visitedFloorIds = [];
      await deleteProgActors(session, pid); // delete backing prog-ICE actors first.
      clearProgFloors(session, pid);
      clearProgState(session, pid);
      prunePendingTests(session, (t) => t.pid === pid);
      // Drop this runner's ICE attachments (SPEC §14.11).
      pruneAttachments(session, (a) => a.pid === pid);
      // Drop its pathfinder reveal.
      if (session.reveal && session.reveal[pid]) delete session.reveal[pid];
    }
    await setWorld("session", session);
    return true;
  },

  async "session.move"({ pid, floorIndex } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner" || !part.archId) return false;

    const isGM = requesterIsGM(callerId);
    if (!isGM && !ownsParticipant(part, callerId)) return false;

    const archs = getWorld("netArchs") || {};
    const arch = archs[part.archId];
    const floors = arch?.floors || [];
    if (!floors.length) return false;
    const graph = topology(arch);
    if (graph.error) return { error: graph.error };

    const from = Math.max(0, Math.min(floors.length - 1, Number(part.floorIndex) || 0));
    const dest = Number(floorIndex);
    if (!Number.isInteger(dest) || !floors[dest]) return { error: "CRNS.Errors.MoveStep" };

    // Owners walk tree edges. GM placement remains unrestricted.
    if (!isGM) {
      if (dest !== from && graph.parents[from] !== dest && graph.parents[dest] !== from) return { error: "CRNS.Errors.MoveStep" };
      if (graph.parents[dest] === from && isBlockingPasswordFloor(session, part.archId, floors[from])) {
        return { error: "CRNS.Errors.PasswordBlocked" };
      }
    }

    const visited = new Set(part.visitedFloorIds || []);
    if (floors.every((f) => !Object.hasOwn(f, "parentId"))) {
      floors.forEach((f, i) => { if (i <= Math.max(Number(part.maxFloor) || 0, from)) visited.add(f.id); });
    }
    visited.add(floors[from].id);
    visited.add(floors[dest].id);
    part.visitedFloorIds = [...visited];
    if (dest !== from) part.scoutActionSerial = (part.scoutActionSerial || 0) + 1;
    part.floorIndex = dest;
    // Track the deepest floor the runner has visited (fog-of-war baseline §14.7).
    part.maxFloor = Math.max(Number(part.maxFloor) || 0, dest);

    // Attached ICE follow the runner to the new floor (SPEC §14.11). Runtime
    // follows ignore the 3-per-floor editor cap. Two attachment shapes:
    //   {iceId}  → arch ICE def, moved between floors (rewrites targets)
    //   {progKey} → a player TRAP BI chasing the runner it caught (Addendum 2):
    //               just update its stored floorIndex (mode stays "trap").
    let archsChanged = false;
    for (const att of session.attachments || []) {
      if (att.pid !== pid || att.archId !== part.archId) continue;
      if (att.progKey) {
        const st = (session.progState || {})[att.progKey];
        if (st && Number(st.floorIndex) !== dest) st.floorIndex = dest;
      } else if (att.iceId) {
        if (moveIceDefToFloor(session, archs, part.archId, att.iceId, dest)) archsChanged = true;
      }
    }
    if (archsChanged) await setWorld("netArchs", archs);

    // A runner ENTERING a floor with alive Black ICE provokes a SPEED test.
    await triggerFloorIce(session, part.archId, pid);
    await setWorld("session", session);
    return true;
  },

  async "session.setTarget"({ entityRef } = {}, callerId) {
    const session = getWorld("session") || {};
    session.targets = session.targets || {};
    // Any user currently in the session (runner/spectator) or the GM may target.
    const inSession = requesterIsGM(callerId)
      || Object.values(session.participants || {}).some((p) => ownsParticipant(p, callerId));
    if (!inSession) return false;

    const ref = validEntityRef(entityRef) ? entityRef : "";
    // Toggle: setting the current target again clears it.
    session.targets[callerId] = session.targets[callerId] === ref ? "" : ref;
    await setWorld("session", session);
    return true;
  },

  /* ---- ent ---- (Phase C) — operate on the backing blackIce/demon actors
   *   via bridge.damageEntity / actor.update on the GM side */

  async "ent.damage"({ actorId, amount, sourceRef = "", sourceName = "", sourceProgram = null, effect = "", random = false } = {}, callerId) {
    const session = getWorld("session") || {};
    if (!requesterIsGM(callerId)) {
      // Non-GM: must own a participant AND their own stored target must be an
      // ice:/demon: ref resolving to exactly this actor.
      const inSession = Object.values(session.participants || {})
        .some((p) => ownsParticipant(p, callerId));
      if (!inSession) return false;
      const myTarget = (session.targets || {})[callerId] || "";
      if (refActorId(myTarget) !== actorId || !actorId) return { error: "CRNS.Errors.NotYourTarget" };
      if (!canDamageTarget(session, myTarget, callerId)) return { error: "CRNS.Errors.NotYourTarget" };
    }
    const dmg = clampDamage(amount);
    const ok = await bridge.damageEntity(actorId, dmg);
    if (!ok) return ok;
    // Chat: name the TARGET correctly (the damaged actor), then a distinct
    // "destroyed" card when its REZ hit 0.
    const targetActor = game.actors?.get(actorId);
    const targetName = targetActor?.name || "";
    postDamageCard(targetName, dmg);
    const rez = targetActor?.system?.stats?.rez?.value ?? 1;
    if (rez <= 0) {
      // If the damaged actor backs a PLAYER Black-ICE program (deployed/trap BI),
      // run the same destruction cleanup a run.progDamage kill would — derez the
      // program item, delete the actor, lock it out (§10), prune reactions — so a
      // GM killing it from the entity panel breaks it reliably too.
      const progKey = progKeyForActorId(session, actorId);
      if (progKey) {
        const cut = progKey.lastIndexOf("|");
        const pKpid = progKey.slice(0, cut);
        const pKprog = progKey.slice(cut + 1);
        await defeatProgram(session, pKpid, pKprog, { sourceRef, sourceName, sourceProgram, effect, random }, callerId);
        await setWorld("session", session);
      } else {
        postChatCard(loc("CRNS.Rules.Derezzed"), targetName);
        // Derezzed arch ICE can no longer act: drop pending SPEED tests pointing
        // at it and any attachments it held.
        let changed = prunePendingTests(session, (t) => t.iceActorId === actorId);
        const iceIds = iceDefIdsForActor(actorId);
        if (iceIds.size && pruneAttachments(session, (a) => iceIds.has(a.iceId))) changed = true;
        if (changed) await setWorld("session", session);
      }
    }
    return ok;
  },

  async "ent.setRez"({ actorId, value } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const ok = await bridge.setEntityRez(actorId, value);
    const session = getWorld("session") || {};
    const key = progKeyForActorId(session, actorId);
    if (ok && key && Number(value) > 0) {
      if (session.defeated) delete session.defeated[key];
      const [pid, programId] = key.split("|");
      const actor = fromUuidSync(session.participants[pid].actorUuid);
      await actor?.getOwnedItem?.(programId)?.update({ "system.rez.value": Number(value) });
      await bridge.setProgramDefeated(actor, programId, false);
      await setWorld("session", session);
    }
    return ok;
  },

  async "ent.restore"({ actorId } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    return OPS["ent.setRez"]({ actorId, value: game.actors?.get(actorId)?.system?.stats?.rez?.max || 0 }, callerId);
  },

  async "ent.reset"({ archId } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const archs = getWorld("netArchs") || {};
    const arch = archs[archId];
    if (!arch) return false;
    for (const id of archActorIds(arch)) await bridge.restoreEntity(id);
    return true;
  },

  /** GM: move an entity actor (ICE or Demon) to the top of the combat turn queue.
   *  `demon` true posts the "demon activated" card; else the plain ICE card. */
  async "ent.toQueue"({ actorId, demon = false } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!actorId) return false;
    const actor = game.actors?.get(actorId);
    const name = actor?.name || "";
    const queued = await moveToTopOfQueue(actorId);
    if (!queued) {
      postChatCard(loc("CRNS.Chat.TurnQueue"), loc("CRNS.Chat.NoCombat"), { whisperGM: true });
      return false;
    }
    if (demon) postChatCard(name, loc("CRNS.Chat.DemonActivated", { name }));
    else postChatCard(name, loc("CRNS.Chat.ToQueue", { name }));
    return true;
  },

  /** GM: move an ICE/Demon def from its current floor to another floor of the
   *  same arch. Validates target-floor capacity, then rewrites any session
   *  targets that referenced the entity's old floorId. */
  async "ent.move"({ archId, entId, toFloorIndex } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const archs = getWorld("netArchs") || {};
    const arch = archs[archId];
    if (!arch) return false;
    const floors = arch.floors || [];
    const toIndex = Number(toFloorIndex);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= floors.length) return false;
    const target = floors[toIndex];

    // Locate the def (ice array entry or the demon) in any source floor.
    let srcFloor = null, kind = "", def = null, iceIndex = -1;
    for (const floor of floors) {
      const idx = (floor.ice || []).findIndex((i) => i.id === entId);
      if (idx >= 0) { srcFloor = floor; kind = "ice"; def = floor.ice[idx]; iceIndex = idx; break; }
      if (floor.demon && floor.demon.id === entId) { srcFloor = floor; kind = "demon"; def = floor.demon; break; }
    }
    if (!srcFloor || !def) return false;
    if (srcFloor.id === target.id) return true; // already there — no-op.

    // Validate target capacity.
    if (kind === "ice") {
      if ((target.ice || []).length >= MAX_ICE_PER_FLOOR) return { error: "CRNS.Errors.FloorFull" };
    } else {
      if (target.demon) return { error: "CRNS.Errors.FloorFull" };
    }

    // Remove from source, push to target.
    if (kind === "ice") {
      srcFloor.ice.splice(iceIndex, 1);
      target.ice = target.ice || [];
      target.ice.push(def);
    } else {
      srcFloor.demon = null;
      target.demon = def;
    }
    await setWorld("netArchs", archs);

    // Rewrite session targets: <kind>:<archId>:<oldFloorId>:<entId> → new floorId.
    const session = getWorld("session") || {};
    let changed = false;
    for (const [uid_, ref] of Object.entries(session.targets || {})) {
      const [rKind, rArch, rFloor, rEnt] = (ref || "").split(":");
      if (rKind === kind && rArch === archId && rFloor === srcFloor.id && rEnt === entId) {
        session.targets[uid_] = `${kind}:${archId}:${target.id}:${entId}`;
        changed = true;
      }
    }
    if (changed) await setWorld("session", session);
    return true;
  },

  /* ---- runner roster (Phase C) ---- */

  async "runner.remove"({ pid } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    if (!parts[pid]) return false;
    clearRunnerReferences(session, pid);
    clearProgFloors(session, pid);
    clearDestroyed(session, pid);
    if (session.reveal) delete session.reveal[pid];
    // Delete the runner's backing prog-ICE actors before dropping it (Task 1).
    await deleteProgActors(session, pid);
    clearProgState(session, pid);
    // Drop attachments/pending tests where this pid is the chased/attacked runner
    // (a player BI chasing them, or an arch-ICE follow) — Addendum 2/5.
    pruneAttachments(session, (a) => a.pid === pid);
    prunePendingTests(session, (t) => t.pid === pid);
    delete parts[pid];
    await setWorld("session", session);
    return true;
  },

  /* ---- run ---- (Phase D) */

  async "equipment.action"({ pid, action, ...options } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return false;
    const actor = fromUuidSync(acting.part.actorUuid);
    if (!actor) return false;
    const result = await equipmentAction(session, pid, action, actor, bridge, options);
    await setWorld("session", session);
    return result;
  },

  async "equipment.effect"({ pid, effect, sourceRef = "" } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const part = session.participants?.[pid];
    const actor = part?.actorUuid ? fromUuidSync(part.actorUuid) : null;
    if (!actor) return false;
    let sourceKind = effect === "emp" ? "emp" : sourceRef.startsWith("ice:") ? "blackice" : "program";
    if (sourceRef.startsWith("prog:")) {
      const [, ownerPid, programId] = sourceRef.split(":");
      const sourceOwner = session.participants?.[ownerPid]?.actorUuid ? fromUuidSync(session.participants[ownerPid].actorUuid) : null;
      if (sourceOwner?.getOwnedItem?.(programId)?.system?.class === "blackice") sourceKind = "blackice";
    }
    if (equipmentProtection(actor, effect, { sourceKind })) {
      postChatCard(actor.name, loc("CRNS.Equipment.Protected"));
      return { ok: true, protected: true };
    }
    part.netEffects ||= {};
    if (effect === "ignite") part.netEffects.fire = true;
    else if (effect === "forceJackOut") return OPS["run.jack"]({ pid, in: false, safe: equipmentProfile(actor, bridge.getDeck(actor)).safeJackout, forced: true }, callerId);
    else if (["randomDestroy", "randomNonIce", "raven"].includes(effect)) {
      const list = (bridge.installedPrograms(bridge.getDeck(actor)) || []).filter(p => !session.destroyed?.[`${pid}|${p.id}`]
        && (effect === "randomNonIce" ? p.system.class !== "blackice"
          : effect === "raven" ? p.system.isRezzed && p.system.class === "defender" : true));
      if (list.length) {
        const program = list[Math.floor(Math.random() * list.length)];
        if (effect === "raven") {
          const [, ownerPid] = sourceRef.split(":");
          const owner = sourceRef.startsWith("prog:") && session.participants?.[ownerPid]?.actorUuid ? fromUuidSync(session.participants[ownerPid].actorUuid) : null;
          if (owner && equipmentProfile(owner, bridge.getDeck(owner)).aerie) {
            if (await autoDerezDestroyedProg(session, pid, program.id, { sourceRef, random: true })) await afterEquipmentDestroy(session, sourceRef, bridge);
          } else await defeatProgram(session, pid, program.id, {}, callerId);
        }
        else if (await autoDerezDestroyedProg(session, pid, program.id, { sourceRef, random: true })) await afterEquipmentDestroy(session, sourceRef, bridge);
      }
    } else if (["emp", "disableDeck", "destroyDeck"].includes(effect)) {
      part.netEffects.deckDisabled = true;
      await actor.setFlag(MODULE_ID, "deckDisabled", true);
    } else if (effect === "clear") {
      part.netEffects = {};
      await actor.unsetFlag(MODULE_ID, "deckDisabled");
    } else return false;
    await setWorld("session", session);
    postChatCard(actor.name, loc(`CRNS.Equipment.Effects.${effect}`));
    return { ok: true, protected: false };
  },

  async "equipment.clearEffect"({ pid, key } = {}, callerId) {
    if (!requesterIsGM(callerId) || !["fire", "deckDisabled"].includes(key)) return false;
    const session = getWorld("session") || {};
    const part = session.participants?.[pid];
    if (!part || part.kind !== "runner") return false;
    if (part.netEffects) delete part.netEffects[key];
    const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
    if (key === "deckDisabled") await actor?.unsetFlag?.(MODULE_ID, "deckDisabled");
    await setWorld("session", session);
    return true;
  },

  async "equipment.turnEnd"({ pid, key } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {}, part = session.participants?.[pid];
    if (!part || part.equipmentEndKey === key) return false;
    part.equipmentEndKey = key;
    const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
    if (actor && part.netEffects?.fire) await bridge.damageRunnerHp(actor.id, 2);
    await setWorld("session", session);
    return true;
  },

  async "equipment.recordDeath"({ actorUuid, eventId } = {}, callerId) {
    if (!requesterIsGM(callerId) || !eventId) return false;
    const session = getWorld("session") || {};
    const victim = Object.values(session.participants || {}).find(p => p.actorUuid === actorUuid && p.jackedIn && p.archId);
    if (!victim) return false;
    session.recordedDeaths ||= [];
    if (session.recordedDeaths.includes(eventId)) return false;
    session.recordedDeaths.push(eventId);
    session.recordedDeaths = session.recordedDeaths.slice(-100);
    for (const [pid, part] of Object.entries(session.participants || {})) {
      if (!part.jackedIn || part.archId !== victim.archId || part.actorUuid === actorUuid) continue;
      const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
      if (!actor || !equipmentProfile(actor, bridge.getDeck(actor)).combatRecorder) continue;
      session.equipment ||= {}; session.equipment[pid] ||= {};
      const state = session.equipment[pid]; state.recordings ||= [];
      state.recordings.push({ id: eventId, at: Date.now(), minutes: 5, value: 50, anonymized: true });
      postChatCard(actor.name, loc("CRNS.Equipment.RecordingSaved"));
    }
    await setWorld("session", session);
    return true;
  },

  async "equipment.backupRemoved"({ actorUuid, driveIds = [] } = {}, callerId) {
    const session = getWorld("session") || {};
    let changed = false;
    for (const [pid, part] of Object.entries(session.participants || {})) {
      if (part.actorUuid !== actorUuid || (!requesterIsGM(callerId) && !ownsParticipant(part, callerId))) continue;
      const backups = session.equipment?.[pid]?.backups || {};
      for (const [id, copy] of Object.entries(backups)) {
        const remaining = (copy.driveIds || []).filter(drive => !driveIds.includes(drive));
        if (remaining.length === copy.driveIds?.length) continue;
        changed = true;
        if (remaining.length) copy.driveIds = remaining; else delete backups[id];
      }
    }
    if (changed) await setWorld("session", session);
    return true;
  },

  async "run.activateProgram"({ pid, programId, targetRef = "", mode = "", override = false } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting || acting.part.jackedIn === false) return false;
    const { part } = acting;
    const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
    const deck = bridge.getDeck(actor);
    if (part.netEffects?.deckDisabled) return { error: "CRNS.Equipment.DeckDisabled" };
    const excludedProgramIds = Object.keys(session.destroyed || {}).filter(key => key.startsWith(`${pid}|`)).map(key => key.slice(pid.length + 1));
    const loadout = validateEquipmentLoadout(actor, deck, { excludedProgramIds });
    if (!loadout.valid) return { error: "CRNS.Equipment.InvalidLoadout", details: loadout.errors };
    const program = (bridge.installedPrograms(deck) || []).find((p) => p.id === programId);
    if (!program) return false;
    const key = `${pid}|${programId}`;
    const gmOverride = override && requesterIsGM(callerId);
    const cls = program.system.class;
    const custom = bridge.programDefinition?.(program);
    const attacker = ["antipersonnelattacker", "antiprogramattacker"].includes(cls);
    if (session.destroyed?.[key]) return { error: "CRNS.Errors.ProgramDestroyed" };
    if (program.system.isRezzed || session.defeated?.[key]) return { error: "CRNS.Rules.DeactivateFirst" };
    if (!gmOverride && programUsed(session, part, programId)) return { error: "CRNS.Errors.AlreadyRezzed" };
    const once = custom ? custom.usage === "run" : cls === "defender" || programName(program) === "superglue";
    if (!gmOverride && once && part.runUsedIds?.[programId]) return { error: "CRNS.Rules.OncePerRun" };
    if (cls === "defender" && (bridge.installedPrograms(deck) || []).some((p) => p.id !== programId && p.system?.isRezzed
      && !session.defeated?.[`${pid}|${p.id}`] && Number(p.system.rez?.value) > 0
      && programName(p) === programName(program))) return { error: "CRNS.Rules.OneDefender" };
    if (attacker || (cls === "blackice" && mode === "deployed")) {
      if (!validEntityRef(targetRef) || targetRef === `runner:${pid}`) return { error: "CRNS.Errors.NoTarget" };
      const targets = targetRef.split(":");
      let valid = false;
      if (targets[0] === "runner") {
        const target = session.participants?.[targets[1]];
        valid = !!target && target.kind === "runner" && target.archId === part.archId && target.jackedIn !== false && target.floorIndex === part.floorIndex;
      } else if (targets[0] === "prog") {
        const target = session.participants?.[targets[1]];
        valid = !!target && target.archId === part.archId && activeProgramRefs(session, targets[1]).includes(targetRef);
        const ps = session.progState?.[`${targets[1]}|${targets[2]}`];
        valid &&= Number(ps?.floorIndex ?? target.floorIndex ?? 0) === Number(part.floorIndex || 0);
      } else {
        const arch = (getWorld("netArchs") || {})[part.archId];
        valid = targets[1] === part.archId && arch?.floors?.[part.floorIndex || 0]?.id === targets[2]
          && (game.actors?.get(refActorId(targetRef))?.system?.stats?.rez?.value ?? 0) > 0;
      }
      const antiProgram = cls === "antiprogramattacker" || (cls === "blackice" && isAntiProgram(program));
      const targetOwner = targets[0] === "prog" ? session.participants?.[targets[1]] : null;
      const targetProgram = targetOwner?.actorUuid ? fromUuidSync(targetOwner.actorUuid)?.getOwnedItem?.(targets[2]) : null;
      const targetKind = targets[0] === "prog" && targetProgram?.system?.class === "blackice" ? "blackIce"
        : { runner: "runner", prog: "program", ice: "blackIce", demon: "demon" }[targets[0]];
      if (!valid || (custom ? !custom.targets.includes(targetKind) : antiProgram ? targets[0] === "runner" : targets[0] !== "runner")) return { error: "CRNS.Rules.InvalidTarget" };
    }
    if (cls === "blackice" && mode !== "deployed" && mode !== "trap") return false;
    if (cls === "blackice" && mode === "trap" && game.combat?.started) return { error: "CRNS.Rules.TrapCombat" };
    const actionCost = custom?.netActions ?? 1;
    const scoutSerialBefore = part.scoutActionSerial || 0;
    const spent = spendNet(part, actionCost, gmOverride);
    if (spent !== true) return spent;
    if (!await bridge.rezProgram(actor, programId)) return false;
    rememberProgram(session, part, programId);
    part.runUsedIds ||= {};
    if (once) part.runUsedIds[programId] = true;
    part.rezzed ||= {};
    part.rezzed[programId] = { rezzed: true };
    part.activations ||= {};
    const activationId = uid("pa");
    part.activations[programId] = { id: activationId, targetRef, attacker, spent: !gmOverride, cost: actionCost, once,
      scoutSerialBefore, scoutSerial: part.scoutActionSerial || 0 };
    await setWorld("session", session);
    if (cls === "blackice") {
      const res = await OPS["run.progDeploy"]({ pid, programId, mode, targetRef }, callerId);
      if (res !== true) return res;
      const deployed = getWorld("session") || {};
      await triggerFloorIce(deployed, part.archId, pid);
      await setWorld("session", deployed);
    } else if (!attacker) {
      await triggerFloorIce(session, part.archId, pid);
      await setWorld("session", session);
    }
    return { ok: true, activationId };
  },

  async "run.applyProgramEffect"({ pid, programId, activationId, cancelled = false, sourceRef = "", sourceName = "", sourceProgram = null, effect = "" } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return false;
    const { part } = acting;
    const reservation = part.activations?.[programId];
    if (!reservation || reservation.id !== activationId || !reservation.attacker) return false;
    const actor = fromUuidSync(part.actorUuid);
    if (!await bridge.derezProgram(actor, programId)) return false;
    delete part.activations[programId];
    if (part.rezzed) delete part.rezzed[programId];
    if (cancelled) {
      if (part.scoutActionSerial === reservation.scoutSerial) part.scoutActionSerial = reservation.scoutSerialBefore;
      if (reservation.spent) part.actions.value = Math.min(part.actions.max, part.actions.value + (reservation.cost || 1));
      const usage = session.programUsage?.[part.actorUuid];
      if (usage?.round === roundKey(part)) delete usage.ids[programId];
      if (reservation.once) delete part.runUsedIds[programId];
    } else part.lastProgramUse = { programId, activationId, targetRef: reservation.targetRef };
    await setWorld("session", session);
    return { ok: true, sourceRef, sourceName, sourceProgram, effect, targetRef: reservation.targetRef };
  },

  async "run.deactivateProgram"({ pid, programId, override = false } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return false;
    const { part } = acting;
    if (!canDerezTrap(session, pid, programId) && !requesterIsGM(callerId)) return { error: "CRNS.Errors.TrapDerezFloor" };
    const actor = fromUuidSync(part.actorUuid);
    if (!actor?.getOwnedItem?.(programId)?.system?.isRezzed) return false;
    queueArmor(session, pid, actor, actor.getOwnedItem(programId));
    if (!(override && requesterIsGM(callerId))) {
      const spent = spendNet(part);
      if (spent !== true) return spent;
    }
    if (!await bridge.derezProgram(actor, programId)) return false;
    await setWorld("session", session);
    return OPS["run.setRezzed"]({ pid, programId, state: null }, callerId);
  },

  async "run.scanner"({ pid } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return false;
    const { part } = acting;
    if (part.meatActionTurn === turnKey(part) || part.netActionTurn === turnKey(part)) return { error: "CRNS.Rules.MeatActionUsed" };
    part.meatActionTurn = turnKey(part);
    part.scoutActionSerial = (part.scoutActionSerial || 0) + 1;
    await setWorld("session", session);
    return true;
  },

  async "run.slideAttempt"({ pid, targetRef, destination } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return false;
    const { part } = acting;
    const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
    const used = part.slideTurn === turnKey(part) ? (part.slideCount || 1) : 0;
    const limit = equipmentProfile(actor, bridge.getDeck(actor)).slideAttempts || 1;
    if (part.slideAttempt || used >= limit) return { error: "CRNS.Rules.SlideUsed" };
    const [kind, a, , iceId] = String(targetRef || "").split(":");
    const prog = kind === "prog" ? targetRef.slice(5).replace(":", "|") : "";
    const attached = (session.attachments || []).some((s) => s.pid === pid && s.archId === part.archId && (prog ? s.progKey === prog : kind === "ice" && a === part.archId && s.iceId === iceId));
    if (!attached || !slideDestinations(session, pid).some((d) => d.floorIndex === Number(destination))) return { error: "CRNS.Rules.InvalidSlide" };
    if (part.meatActionTurn === turnKey(part) || (part.actions?.value || 0) < 1) return { error: "CRNS.Errors.NoActions" };
    part.actions.value -= 1;
    part.scoutActionSerial = (part.scoutActionSerial || 0) + 1;
    part.netActionTurn = turnKey(part);
    part.slideTurn = turnKey(part);
    part.slideCount = used + 1;
    part.slideAttempt = { targetRef, destination: Number(destination) };
    await setWorld("session", session);
    return true;
  },

  async "run.virusConfigure"({ pid, dv, actions } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const part = session.participants?.[pid];
    if (!part || !Number.isInteger(Number(dv)) || Number(dv) < 0 || !Number.isInteger(Number(actions)) || Number(actions) < 1) return false;
    const arch = (getWorld("netArchs") || {})[part.archId];
    if (topology(arch).rootIndex !== (part.floorIndex || 0)) return { error: "CRNS.Rules.VirusBottom" };
    part.virusWork = { dv: Number(dv), actions: Number(actions), spent: 0, archId: part.archId, floorId: arch.floors[part.floorIndex || 0].id };
    await setWorld("session", session);
    return true;
  },

  async "run.virusSpend"({ pid } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return false;
    const { part } = acting;
    const work = part.virusWork;
    const arch = (getWorld("netArchs") || {})[part.archId];
    if (!work || work.archId !== part.archId || arch?.floors?.[part.floorIndex || 0]?.id !== work.floorId) return { error: "CRNS.Rules.VirusConfigure" };
    if (work.spent >= work.actions) return { ok: true, ready: true, remaining: 0 };
    if (part.meatActionTurn === turnKey(part)) return { error: "CRNS.Rules.MeatActionUsed" };
    const spend = Math.min(work.actions - work.spent, part.actions?.value || 0);
    if (spend < 1) return { error: "CRNS.Errors.NoActions" };
    part.actions.value -= spend;
    part.scoutActionSerial = (part.scoutActionSerial || 0) + 1;
    part.netActionTurn = turnKey(part);
    work.spent += spend;
    await setWorld("session", session);
    return { ok: true, ready: work.spent === work.actions, remaining: work.actions - work.spent };
  },

  /** Jack In/Out toggle from the UI. Costs 1 action. Jack-out clears the
   *  rezzed mirror (the GM decides actual disconnection). */
  async "run.jack"({ pid, in: jackIn, safe = true, forced = false } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    const actions = part.actions || { value: 0, max: 0 };
    if (!!part.jackedIn === !!jackIn) return false;
    const spent = forced && requesterIsGM(callerId) ? true : spendNet(part);
    if (spent !== true) return spent;
    part.actions = actions;
    part.jackedIn = !!jackIn;
    const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
    if (jackIn) {
      part.runUsedIds = {};
      if (actor) await onEquipmentJackIn(session, pid, actor, bridge);
    }
    if (!jackIn) {
      clearRunnerReferences(session, pid);
      if (actor) await onEquipmentJackOut(session, pid, actor, bridge, { safe });
      for (const p of bridge.installedPrograms(bridge.getDeck(actor)) || []) {
        if (p.system?.isRezzed) await bridge.derezProgram(actor, p.id);
      }
      part.virusWork = null;
      part.rezzed = {}; // Clear the rezzed mirror on jack-out.
      await deleteProgActors(session, pid); // delete backing prog-ICE actors first.
      clearProgFloors(session, pid); // …and any floor overrides for it.
      clearProgState(session, pid);  // …and any trap/deployed BI state (§14.12).
      pruneAttachments(session, (a) => a.pid === pid); // …and ICE attachments.
      if (session.reveal && session.reveal[pid]) delete session.reveal[pid];
    }
    await setWorld("session", session);
    return true;
  },

  /** Spend NET actions (clamped at 0). */
  async "run.spend"({ pid, n = 1 } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    const spent = spendNet(part, Number(n));
    if (spent !== true) return spent;
    await setWorld("session", session);
    return true;
  },

  /* Give back NET actions (pip click-to-restore), clamped to max. */
  async "run.give"({ pid, n = 1 } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    const actions = part.actions || { value: 0, max: 0 };
    const max = actions.max || participantActionMax(part);
    actions.value = Math.min(max, (actions.value || 0) + (Number(n) || 0));
    part.actions = actions;
    await setWorld("session", session);
    return true;
  },

  /** Reset one runner's NET actions to a freshly recomputed maximum. */
  async "run.startTurn"({ combatId, round, combatantId } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const combat = game.combat;
    if (!combat || combat.id !== combatId || combat.round !== round) return false;
    const session = getWorld("session") || {};
    if (!combat.started) {
      for (const part of Object.values(session.participants || {})) if (part.lastCombatTurn?.startsWith(`${combatId}:`)) delete part.lastCombatTurn;
      for (const state of Object.values(session.demonState || {})) if (state.lastCombatTurn?.startsWith(`${combatId}:`)) delete state.lastCombatTurn;
      await setWorld("session", session);
      return true;
    }
    const current = combat.combatant;
    if (!current || current.id !== combatantId) return false;
    const stamp = `${combatId}:${round}:${combatantId}`;
    let changed = false;
    for (const [pid, part] of Object.entries(session.participants || {})) {
      if (part.kind !== "runner" || part.lastCombatTurn === stamp) continue;
      const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
      if (!actor || !combatantMatchesActor(current, part.actorUuid, actor.id)) continue;
      const max = participantActionMax(part);
      part.actions = { value: max, max }; part.lastCombatTurn = stamp;
      await onEquipmentTurn(session, pid, actor, bridge);
      changed = true;
    }
    if (current.actor?.type === "demon") {
      const state = ensureDemonState(session, current.actor.id);
      if (state && state.lastCombatTurn !== stamp) { state.value = state.max; state.lastCombatTurn = stamp; changed = true; }
    }
    if (changed) await setWorld("session", session);
    return changed;
  },

  /** Explicit refresh from the action panel, including manual rounds outside combat. */
  async "run.reset"({ pid } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;

    const max = participantActionMax(part);
    part.actions = { value: max, max };
    if (!game.combat?.started) { part.roundSerial = (part.roundSerial || 0) + 1; part.turnSerial = (part.turnSerial || 0) + 1; }
    const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
    if (actor) await onEquipmentTurn(session, pid, actor, bridge);
    await setWorld("session", session);
    return true;
  },

  /** Reset every runner's NET actions (optionally only those in one arch). GM. */
  async "run.resetAll"({ archId = "" } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    for (const [pid, part] of Object.entries(parts)) {
      if (part.kind !== "runner") continue;
      if (archId && part.archId !== archId) continue;
      const max = participantActionMax(part);
      part.actions = { value: max, max };
      if (!game.combat?.started) { part.roundSerial = (part.roundSerial || 0) + 1; part.turnSerial = (part.turnSerial || 0) + 1; }
      const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
      if (actor) await onEquipmentTurn(session, pid, actor, bridge);
    }
    await setWorld("session", session);
    return true;
  },

  /** Mark that a SPECIFIC program was rezzed this turn (§9 — the limit is per
   *  PROGRAM ITEM: the same item cannot be rezzed twice in one turn, but other
   *  copies/programs may). owner-or-GM. Called after a successful rez. */
  async "run.markRez"({ pid, programId = "" } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner" || !programId) return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;
    rememberProgram(session, part, programId);
    await setWorld("session", session);
    return true;
  },

  /** GM: lift the destroyed-program lockout (§10). `pid` null clears ALL runners'
   *  destroyed entries ("Restore programs"); otherwise just that runner's. */
  async "run.clearDestroyed"({ pid = null } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    if (clearDestroyed(session, pid)) await setWorld("session", session);
    return true;
  },

  /** Clear a resolved SPEED test. GM, or the owner of the test's runner pid. */
  async "run.clearSpeedTest"({ testId } = {}, callerId) {
    const session = getWorld("session") || {};
    const list = session.pendingTests || [];
    const test = list.find((t) => t.id === testId);
    if (!test) return true; // already gone — idempotent.
    if (!requesterIsGM(callerId)) {
      const part = (session.participants || {})[test.pid];
      if (!ownsParticipant(part, callerId)) return false;
    }
    if (prunePendingTests(session, (t) => t.id === testId)) {
      await setWorld("session", session);
    }
    return true;
  },

  /** Maintain the per-runner rezzed Black-ICE mirror (null deletes the entry). */
  async "run.setRezzed"({ pid, programId, state = null } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner") return false;
    if (!requesterIsGM(callerId) && !ownsParticipant(part, callerId)) return false;
    if (!programId) return false;

    part.rezzed = part.rezzed || {};
    if (state === null || state === undefined) {
      delete part.rezzed[programId];
      // A derezzed program can no longer have a floor override or prog state.
      // Delete its backing prog-ICE actor first (SPEC §14.12 / Task 1) — derez
      // restores REZ per module rule, so nothing mirrors back to the item.
      const progKey = `${pid}|${programId}`;
      if (session.defeated) delete session.defeated[progKey];
      const derezActorId = (session.progState || {})[progKey]?.actorId || "";
      await deleteProgActors(session, pid, programId);
      if (session.progFloors) delete session.progFloors[progKey];
      if (session.progState) delete session.progState[progKey];
      // Drop the reactions this BI provoked (pendingTests / attachments / slid).
      pruneProgBiSideEffects(session, derezActorId, progKey);
    } else {
      part.rezzed[programId] = state;
    }
    await setWorld("session", session);
    return true;
  },

  /** GM: place a runner's rezzed Black-ICE program on a specific floor
   *  (progFloors override). `floorIndex` null deletes the override. */
  async "run.progFloor"({ pid, programId, floorIndex = null } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!pid || !programId) return false;
    const session = getWorld("session") || {};
    session.progFloors = session.progFloors || {};
    const key = `${pid}|${programId}`;
    if (floorIndex === null || floorIndex === undefined) delete session.progFloors[key];
    else session.progFloors[key] = Number(floorIndex);
    await setWorld("session", session);
    return true;
  },

  /** Apply damage to a runner's rezzed program item (prog: target). */
  async "run.progDamage"({ pid, programId, amount, sourceRef = "", sourceName = "", sourceProgram = null, effect = "", random = false } = {}, callerId) {
    const session = getWorld("session") || {};
    const parts = session.participants || {};
    const part = parts[pid];
    if (!part || part.kind !== "runner" || !part.actorUuid) return false;
    if (!requesterIsGM(callerId)) {
      // Non-GM: must own a participant AND their own stored target must be
      // exactly this rezzed program.
      const inSession = Object.values(parts).some((p) => ownsParticipant(p, callerId));
      if (!inSession) return false;
      const myTarget = (session.targets || {})[callerId] || "";
      if (myTarget !== `prog:${pid}:${programId}`) return { error: "CRNS.Errors.NotYourTarget" };
      if (!canDamageTarget(session, myTarget, callerId)) return { error: "CRNS.Errors.NotYourTarget" };
    }
    const dmg = clampDamage(amount);
    // While rezzed with a backing actor (SPEC §14.12 / Task 1) the ACTOR is the
    // source of truth for REZ — damage it instead of the program item.
    const ps = (session.progState || {})[`${pid}|${programId}`] || null;
    if (ps?.actorId && game.actors?.get(ps.actorId)) {
      const progActor = game.actors.get(ps.actorId);
      const name = progActor?.name || "";
      const ok = await bridge.damageEntity(ps.actorId, dmg);
      if (!ok) return ok;
      postDamageCard(name, dmg);
      // Destroyed (REZ ≤ 0) → auto-derez GM-side + a distinct destroyed card.
      const rez = game.actors?.get(ps.actorId)?.system?.stats?.rez?.value ?? 1;
      if (rez <= 0) {
        await defeatProgram(session, pid, programId, { sourceRef, sourceName, sourceProgram, effect, random }, callerId);
        await setWorld("session", session);
      }
      return ok;
    }
    // Item-backed program BI (no backing actor): damage the program item; on
    // REZ ≤ 0 auto-derez it too (the item is the source of truth here).
    const actor = fromUuidSync?.(part.actorUuid) ?? null;
    if (!actor) return false;
    const name = actor.getOwnedItem?.(programId)?.name || actor.name || "";
    const ok = await bridge.applyProgramDamage(actor, programId, dmg);
    if (!ok) return ok;
    postDamageCard(name, dmg);
    const itemRez = actor.getOwnedItem?.(programId)?.system?.rez?.value ?? 1;
    if (itemRez <= 0) {
      await defeatProgram(session, pid, programId, { sourceRef, sourceName, sourceProgram, effect, random }, callerId);
      await setWorld("session", session);
    }
    return ok;
  },

  /** GM-only: apply "brain damage" straight to a targeted/selected netrunner's HP
   *  (CPR RED — NET damage goes to HP). Resolves the participant's backing actor
   *  and clamps GM-side (bridge.damageRunnerHp). Task 1. */
  async "runner.damage"({ pid, amount, sourceRef = "", sourceName = "", sourceProgram = null, effect = "", isBlackIce = false } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const part = (session.participants || {})[pid];
    if (!part || part.kind !== "runner" || !part.actorUuid) return false;
    const actor = fromUuidSync?.(part.actorUuid) ?? null;
    if (!actor) return false;
    const dmg = await equipmentBrainDamage(session, pid, actor, clampDamage(amount), bridge, { sourceRef, sourceName, sourceProgram, effect, isBlackIce });
    const ok = await bridge.damageRunnerHp(actor.id, dmg, { sourceRef, sourceName, sourceProgram, effect, isBlackIce });
    await setWorld("session", session);
    if (ok) postDamageCard(actor.name, dmg);
    return ok;
  },

  /** GM-only: set a netrunner's current HP directly (clamp 0..max). Task item 5:
   *  GM HP control for a selected runner in the acts-as left zone. */
  async "runner.setHp"({ pid, value } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const part = (session.participants || {})[pid];
    if (!part || part.kind !== "runner" || !part.actorUuid) return false;
    const actor = fromUuidSync?.(part.actorUuid) ?? null;
    if (!actor) return false;
    return bridge.setRunnerHp(actor.id, value);
  },

  /* ---- Round-2: interface-ability results (SPEC §14.7) ---- */

  /** Resolve an interface-ability roll's effect on the floor state. The DV is
   *  never revealed in the (public) chat card — only a neutral verdict.
   *  owner-or-GM for the acting pid. Returns { ok, applied }. */
  async "run.abilityResult"({ pid, ability, total, extra } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return { ok: false, applied: false };
    const { part } = acting;
    const archs = getWorld("netArchs") || {};
    if (part.netEffects?.deckDisabled) return { ok: false, applied: false, error: "CRNS.Equipment.DeckDisabled" };
    const arch = archs[part.archId];
    const floors = arch?.floors || [];
    const floor = floors[part.floorIndex || 0];
    if (!floor) return { ok: false, applied: false };

    const t = Number(total) || 0;
    const name = fromUuidSync?.(part.actorUuid)?.name || "";
    let applied = false;

    switch (ability) {
      case "backdoor": {
        const fx = getFloorFx(session, part.archId, floor.id);
        if (floor.kind === "password" && !fx.breached && t > (Number(floor.dv) || 0)) {
          fx.breached = true;
          applied = true;
        }
        postChatCard(loc("CRNS.Chat.Backdoor"),
          loc(applied ? "CRNS.Chat.Breached" : "CRNS.Chat.NotBreached", { name }));
        break;
      }
      case "cloak": {
        if (session.equipment?.[pid]) session.equipment[pid].swiftyPending = false;
        // Arch-level cloaks (Addendum 6). If the roller already has marker(s) and
        // the new total beats their LOWEST-dv marker → replace that dv (keep its
        // number); else append a new sequentially-numbered marker.
        const list = archCloaks(session, part.archId);
        const mine = list.filter((c) => c.pid === pid);
        let lowest = null;
        for (const c of mine) if (!lowest || (Number(c.dv) || 0) < (Number(lowest.dv) || 0)) lowest = c;
        if (lowest && t > (Number(lowest.dv) || 0)) {
          lowest.dv = t;
        } else {
          const nextN = list.reduce((m, c) => Math.max(m, Number(c.n) || 0), 0) + 1;
          list.push({ id: uid("ck"), n: nextN, pid, dv: t });
        }
        applied = true;
        postChatCard(loc("CRNS.Chat.Cloak"), loc("CRNS.Chat.Cloaked", { name }));
        break;
      }
      case "control": {
        const fx = getFloorFx(session, part.archId, floor.id);
        const contestDv = fx.control?.dv ?? (Number(floor.dv) || 0);
        if (floor.kind === "controlnode" && fx.control?.pid !== pid && t > contestDv) {
          fx.control = { pid, dv: t };
          applied = true;
        }
        postChatCard(loc("CRNS.Chat.Control"),
          loc(applied ? "CRNS.Chat.Controlled" : "CRNS.Chat.ControlFailed", { name }));
        break;
      }
      case "eyedee": {
        const fx = getFloorFx(session, part.archId, floor.id);
        if (floor.kind === "file" && !fx.eyedee.includes(pid) && t > (Number(floor.dv) || 0)) {
          fx.eyedee.push(pid);
          applied = true;
        }
        postChatCard(loc("CRNS.Chat.Eyedee"),
          loc(applied ? "CRNS.Chat.Accessed" : "CRNS.Chat.AccessFailed", { name }));
        break;
      }
      case "virus": {
        const graph = topology(arch);
        const work = part.virusWork;
        if (!work || work.spent < work.actions || work.archId !== part.archId || work.floorId !== floor.id) return { ok: false, applied: false, error: "CRNS.Rules.VirusConfigure" };
        if (!graph.error && (part.floorIndex || 0) === graph.rootIndex && t > work.dv) {
          const fx = getFloorFx(session, part.archId, floor.id);
          fx.viruses.push({ id: uid("fx"), pid, dv: t, removalDV: t, creationDV: work.dv, actions: work.actions });
          applied = true;
        }
        work.spent = 0;
        postChatCard(loc("CRNS.Chat.Virus"),
          loc(applied ? "CRNS.Chat.VirusPlanted" : "CRNS.Chat.VirusFailed", { name }));
        break;
      }
      case "pathfinder": {
        const start = part.floorIndex || 0;
        const graph = topology(arch);
        if (graph.error) return { ok: false, applied: false, error: graph.error };
        const isBlocking = (f) => {
          if (f.kind !== "password") return false;
          const ffx = (session.floorState || {})[floorKey(part.archId, f.id)];
          const breached = !!(ffx && ffx.breached);
          return !breached && (Number(f.dv) || 0) > t;
        };
        const revealed = pathfinderFloors(arch, start, t, isBlocking);
        session.reveal = session.reveal || {};
        session.reveal[pid] = session.reveal[pid] || {};
        const previous = session.reveal[pid][part.archId];
        if (floors.every((f) => !Object.hasOwn(f, "parentId")) && !Array.isArray(previous)) {
          const maxIndex = Math.max(...revealed.map((id) => floors.findIndex((f) => f.id === id)));
          session.reveal[pid][part.archId] = Math.max(Number.isFinite(previous) ? previous : -1, maxIndex);
        } else {
          session.reveal[pid][part.archId] = [...new Set([...(Array.isArray(previous) ? previous : []), ...revealed])];
        }
        applied = true;
        postChatCard(loc("CRNS.Chat.Pathfinder"), loc("CRNS.Chat.PathfinderDone", { name }));
        break;
      }
      default:
        return { ok: false, applied: false };
    }

    await setWorld("session", session);
    return { ok: true, applied };
  },

  /** Transient activation pulse on a controlled node (SPEC §14.7). owner of the
   *  controlling pid or GM. Spends nothing (UI spends); emits a notify for the
   *  highlight + posts a chat card. */
  async "run.nodePulse"({ archId, floorId, override = false } = {}, callerId) {
    const session = getWorld("session") || {};
    const fx = (session.floorState || {})[floorKey(archId, floorId)];
    const controllerPid = fx?.control?.pid || "";
    if (!controllerPid) return false;
    const part = session.participants?.[controllerPid];
    if (!part || part.archId !== archId || part.jackedIn === false) return false;
    // Caller must be GM or own the controlling participant.
    if (!requesterIsGM(callerId)) {
      const part = (session.participants || {})[controllerPid];
      if (!ownsParticipant(part, callerId)) return false;
    }
    const arch = (getWorld("netArchs") || {})[archId];
    const floor = (arch?.floors || []).find((f) => f.id === floorId);
    if (!floor || floor.kind !== "controlnode") return false;
    const stamp = turnKey(part);
    if (!(override && requesterIsGM(callerId)) && fx.pulseTurn === stamp) return { error: "CRNS.Rules.NodeUsed" };
    const spent = spendNet(part, 1, override && requesterIsGM(callerId));
    if (spent !== true) return spent;
    fx.pulseTurn = stamp;
    await setWorld("session", session);
    const label = floor ? (floor.label || loc(`CRNS.Floor.${floor.kind}`)) : "";
    notifyClients({ kind: "nodePulse", archId, floorId });
    postChatCard(loc("CRNS.Chat.NodePulse"), loc("CRNS.Chat.NodePulseBody", { floor: label }));
    return true;
  },

  /** GM: clear the pathfinder reveal of a runner. */
  async "run.clearReveal"({ pid } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    if (session.reveal && session.reveal[pid]) {
      delete session.reveal[pid];
      await setWorld("session", session);
    }
    return true;
  },

  /** GM: clear one slid record. Matches arch ICE (archId+iceId) OR a player-BI
   *  entry (archId+progKey), optionally scoped to a pid (Addendum 2). */
  async "run.clearSlid"({ archId, iceId, progKey = null, pid = null } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const before = (session.slid || []).length;
    session.slid = (session.slid || []).filter((s) => {
      const idMatch = progKey ? s.progKey === progKey : s.iceId === iceId;
      return !(s.archId === archId && idMatch && (pid === null || s.pid === pid));
    });
    if (session.slid.length !== before) await setWorld("session", session);
    return true;
  },

  /** GM override of floor markers (SPEC §14.7). One flexible op:
   *   kind "cloak" + {id}          → remove that ARCH-level cloak (no floorId; Addendum 6)
   *   kind "virus" + {id}          → remove that marker
   *   kind "eyedee" + {pid}        → remove that pid from the access list
   *   kind "breach" + {value}      → set breached true/false
   *   kind "control" + {pid|null}  → set controller (pid) or clear (null) */
  async "fx.clear"({ archId, floorId, kind, id, pid, value } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};

    // Cloaks are arch-level: no floorId, keyed under session.cloaks[archId].
    if (kind === "cloak") {
      const list = archCloaks(session, archId);
      const n = list.length;
      session.cloaks[archId] = list.filter((c) => c.id !== id);
      if (session.cloaks[archId].length !== n) await setWorld("session", session);
      return true;
    }

    const fx = getFloorFx(session, archId, floorId);
    let changed = false;
    switch (kind) {
      case "virus":
        { const n = fx.viruses.length; fx.viruses = fx.viruses.filter((v) => v.id !== id); changed = fx.viruses.length !== n; }
        break;
      case "eyedee":
        { const n = fx.eyedee.length; fx.eyedee = fx.eyedee.filter((p) => p !== pid); changed = fx.eyedee.length !== n; }
        break;
      case "breach":
        { const nv = !!value; if (fx.breached !== nv) { fx.breached = nv; changed = true; } }
        break;
      case "control":
        if (pid === null || pid === undefined) {
          if (fx.control) { fx.control = null; changed = true; }
        } else {
          fx.control = { pid, dv: fx.control?.dv ?? 0 };
          changed = true;
        }
        break;
      default:
        return false;
    }
    if (changed) await setWorld("session", session);
    return true;
  },

  /* ---- Round-2: attachments / follow (SPEC §14.11) ---- */

  /** GM: set the per-ICE follow flag on the backing actor. */
  async "ice.setFollow"({ actorId, value } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!actorId) return false;
    return bridge.setActorFlag(actorId, "follow", !!value);
  },

  /** GM: attach an ICE to a runner (pid) or detach it (pid null). */
  /* GM attach management: arch ICE (iceId) or a player's rezzed BI (progKey). */
  async "ice.attach"({ archId, iceId = "", progKey = "", pid = null } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!archId || (!iceId && !progKey)) return false;
    const session = getWorld("session") || {};
    session.attachments = session.attachments || [];
    const matches = (a) => a.archId === archId
      && (progKey ? a.progKey === progKey : a.iceId === iceId);
    if (pid === null || pid === undefined) {
      const before = session.attachments.length;
      session.attachments = session.attachments.filter((a) => !matches(a));
      if (session.attachments.length !== before) await setWorld("session", session);
      return true;
    }
    const already = session.attachments.some((a) => matches(a) && a.pid === pid);
    if (!already) {
      // One ICE follows one runner at a time — replace any prior attachment.
      session.attachments = session.attachments.filter((a) => !matches(a));
      session.attachments.push(progKey ? { archId, progKey, pid } : { archId, iceId, pid });
      // A manual GM attach overrides an earlier slide-escape by that runner.
      session.slid = (session.slid || []).filter((s) => !(s.archId === archId
        && (progKey ? s.progKey === progKey : s.iceId === iceId) && s.pid === pid));
      await setWorld("session", session);
    }
    return true;
  },

  /** Record a successful slide: drop the ICE's attachment to this runner and add
   *  a slid record so it never re-attaches (until GM clears). GM only — called
   *  by the primary-GM slideTest notify consumer. Handles both arch ICE (iceId)
   *  and player-placed BI (progKey) targets (Addendum 2). */
  async "run.slideResolve"({ archId, iceId, progKey = null, pid } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!archId || !pid || (!iceId && !progKey)) return false;
    const session = getWorld("session") || {};
    const part = session.participants?.[pid];
    const attempt = part?.slideAttempt;
    const expectedRef = progKey ? `prog:${progKey.replace("|", ":")}` : null;
    if (!attempt || (progKey ? attempt.targetRef !== expectedRef : !attempt.targetRef.endsWith(`:${iceId}`))
      || !slideDestinations(session, pid).some((d) => d.floorIndex === attempt.destination)) return false;
    session.slid = session.slid || [];
    if (progKey) {
      pruneAttachments(session, (a) => a.archId === archId && a.progKey === progKey && a.pid === pid);
      const exists = session.slid.some((s) => s.archId === archId && s.progKey === progKey && s.pid === pid);
      if (!exists) session.slid.push({ archId, progKey, pid });
    } else {
      pruneAttachments(session, (a) => a.archId === archId && a.iceId === iceId && a.pid === pid);
      const exists = session.slid.some((s) => s.archId === archId && s.iceId === iceId && s.pid === pid);
      if (!exists) session.slid.push({ archId, iceId, pid });
    }
    delete part.slideAttempt;
    await setWorld("session", session);
    return OPS["session.move"]({ pid, floorIndex: attempt.destination }, callerId);
  },

  async "run.clearSlideAttempt"({ pid, targetRef } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    const session = getWorld("session") || {};
    const part = session.participants?.[pid];
    if (part?.slideAttempt?.targetRef !== targetRef) return false;
    delete part.slideAttempt;
    await setWorld("session", session);
    return true;
  },

  /* ---- Round-2: demon state (SPEC §14.8) ---- */

  /** Seed a demon's NET-action counter lazily from DEMONS[type] and spend n.
   *  GM only (demons are GM-run). */
  async "demon.spend"({ actorId, n = 1 } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!actorId) return false;
    const session = getWorld("session") || {};
    const state = ensureDemonState(session, actorId);
    if (!state) return false;
    state.value = Math.max(0, (state.value || 0) - (Number(n) || 0));
    await setWorld("session", session);
    return true;
  },

  /** Reset a demon's NET-action counter to its max. GM only. */
  async "demon.reset"({ actorId } = {}, callerId) {
    if (!requesterIsGM(callerId)) return false;
    if (!actorId) return false;
    const session = getWorld("session") || {};
    const state = ensureDemonState(session, actorId);
    if (!state) return false;
    state.value = state.max;
    await setWorld("session", session);
    return true;
  },

  /* ---- Round-2: program state — trap vs deployed (SPEC §14.12) ---- */

  /** Deploy an own Black-ICE program in trap or deployed mode. owner-or-GM.
   *  Trap is allowed both in and out of combat and sits on the runner's current
   *  floor; deployed needs a valid target and sits on its stored floor. There is
   *  NO owner-escort/standby behavior — a deployed BI whose target later vanishes
   *  simply sits idle (a dangling targetRef is harmless; the line just won't draw). */
  async "run.progDeploy"({ pid, programId, mode, targetRef = "", floorIndex } = {}, callerId) {
    const session = getWorld("session") || {};
    const acting = resolveActingRunner(session, pid, callerId);
    if (!acting) return false;
    if (!programId || (mode !== "trap" && mode !== "deployed")) return false;
    if (mode === "trap" && game.combat?.started) return { error: "CRNS.Rules.TrapCombat" };
    const reservation = acting.part.activations?.[programId];
    if (!requesterIsGM(callerId) && (!reservation || reservation.targetRef !== targetRef)) return false;

    // Deployed mode requires a valid target; trap needs none.
    if (mode === "deployed" && !validEntityRef(targetRef)) return { error: "CRNS.Errors.NoTarget" };

    const part = acting.part;
    const fi = mode === "trap"
      ? (part.floorIndex || 0)
      : (Number.isInteger(Number(floorIndex)) ? Number(floorIndex) : (part.floorIndex || 0));

    // Create a real blackIce Actor to back the rezzed prog entity (SPEC §14.12 /
    // Task 1): while rezzed the ACTOR is the source of truth for REZ/stats. Read
    // the program snapshot GM-side from the owner's actor; reuse an existing
    // actor if this program was already deployed (re-deploy without re-create).
    const key = `${pid}|${programId}`;
    session.progState = session.progState || {};
    const prev = session.progState[key] || null;
    let actorId = prev?.actorId || "";
    if (!actorId || !game.actors?.get(actorId)) {
      const runnerActor = part.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
      const program = runnerActor?.getOwnedItem?.(programId) ?? null;
      const archName = (getWorld("netArchs") || {})[part.archId]?.name || loc("CRNS.Tree.Untitled");
      if (program) {
        actorId = await bridge.createProgIceActor({
          name: program.name,
          img: program.img,
          per: program.system?.per, spd: program.system?.spd,
          atk: program.system?.atk, def: program.system?.def,
          rez: program.system?.rez?.value, rezMax: program.system?.rez?.max,
          blackIceType: program.system?.blackIceType,
          content: bridge.programDefinition?.(program),
          ...equipmentIceStats(session, pid, runnerActor, program),
        }, archName) || "";
      }
    }

    session.progState[key] = {
      mode,
      targetRef: mode === "deployed" ? targetRef : "",
      floorIndex: fi,
      actorId,
    };

    // Deployment queues the ICE; only an ambush grants a SPEED test/effect.
    if (mode === "deployed" && actorId) {
      const iceActor = game.actors?.get(actorId);
      const iceName = iceActor?.name || loc("CRNS.Actions.KindIce");
      await moveToTopOfQueue(actorId);
      const [tKind] = (targetRef || "").split(":");
      if (tKind === "runner" || tKind === "prog") {
        const targetPid = targetRef.split(":")[1];
        const targetPart = (session.participants || {})[targetPid];
        if (targetPart && targetPart.kind === "runner") {
          // Attach to the TARGET runner so the BI CHASES them between floors
          // (Addendum 5) — same prog-attachment shape as a triggered trap. Skip
          // if that runner already slid this BI; dedup otherwise. Ends on the
          // target's disconnect/jack-out (pruned by a.pid) or a successful slide.
          session.attachments = session.attachments || [];
          session.slid = session.slid || [];
          const slidBy = session.slid.some((s) => s.archId === part.archId && s.progKey === key && s.pid === targetPid);
          const attached = session.attachments.some((a) => a.archId === part.archId && a.progKey === key && a.pid === targetPid);
          if (!slidBy && !attached) {
            session.attachments.push({ archId: part.archId, progKey: key, pid: targetPid });
          }
          // Ensure the targeted runner sits in the combat with rolled initiative
          // (and re-bump this BI above it) — same bootstrap as floor encounters.
          await bootstrapRunnerCombat(targetPart, [actorId]);
        }
      }
      postChatCard(iceName, loc("CRNS.Rules.Deployed"));
    }

    await setWorld("session", session);
    return true;
  },
};

/** Whether an op handler is registered. Used to guard optional calls (e.g. the
 *  combat hooks trying to run run.reset before Phase D exists). */
export function hasOp(op) {
  return Object.hasOwn(OPS, op) && typeof OPS[op] === "function";
}

let operationQueue = Promise.resolve();

export async function applyOp(op, payload, userId) {
  if (typeof op !== "string" || !hasOp(op) || !game.users.get(userId)
    || !payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const fn = OPS[op];
  if (!fn) {
    console.warn(`${MODULE_ID} | unknown op ${op}`);
    return false;
  }
  payload = foundry.utils.deepClone(payload);
  const pending = operationQueue.then(async () => {
    try { return await fn(payload, userId); }
    catch (e) {
      console.error(`${MODULE_ID} | op ${op} failed`, e);
      return false;
    }
  });
  operationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}
