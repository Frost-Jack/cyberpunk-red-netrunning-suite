/* Cyberpunk RED — Netrunning Suite: entry point.
 * Settings registration, Handlebars helpers, template preload, hooks. */

import { MODULE_ID, TPL, THEMES, loc, esc, BLACK_ICE, blackIceTypeForName } from "./constants.js";
import { WORLD_OBJECTS, getWorld, setWorld, isPrimaryGM, mutate, hasOp, notifyClients, activeProgramRefs, combatantMatchesActor } from "./data.js";
import { initSocket } from "./socket.js";
import * as bridge from "./cpr-bridge.js";
import { eligibleNetrunner } from "./cpr-bridge.js";
import NetrunningSuiteApp from "./apps/suite-app.js";
import { loadProgramIcons } from "./program-icons.js";
import { ensureSuiteStyles } from "./styles.js";
import { play3DAttack } from "./apps/architecture-3d.js";

/* ------------------------------------------------------------------ */
/* init: settings + helpers                                            */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  // World-object stores.
  for (const [key, def] of Object.entries(WORLD_OBJECTS)) {
    game.settings.register(MODULE_ID, key, {
      scope: "world", config: false,
      type: Object, default: foundry.utils.deepClone(def),
    });
  }

  // Config-visible settings (SPEC §3.5).
  game.settings.register(MODULE_ID, "allowSpectators", {
    name: "CRNS.Settings.AllowSpectators", hint: "CRNS.Settings.AllowSpectatorsHint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: rerenderNow,
  });
  game.settings.register(MODULE_ID, "spectatorFreeMove", {
    name: "CRNS.Settings.SpectatorFreeMove", hint: "CRNS.Settings.SpectatorFreeMoveHint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: rerenderNow,
  });
  game.settings.register(MODULE_ID, "autoRollNPC", {
    name: "CRNS.Settings.AutoRollNPC", hint: "CRNS.Settings.AutoRollNPCHint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: rerenderNow,
  });
  game.settings.register(MODULE_ID, "theme", {
    name: "CRNS.Settings.Theme", hint: "CRNS.Settings.ThemeHint",
    scope: "client", config: true, type: String, default: "green",
    choices: Object.fromEntries(THEMES.map((t) => [t, `CRNS.Themes.${t}`])),
    onChange: rerenderNow,
  });

  registerHandlebarsHelpers();
});

/* ------------------------------------------------------------------ */
/* ready: socket, singleton app, template preload                      */
/* ------------------------------------------------------------------ */

Hooks.once("ready", async () => {
  await ensureSuiteStyles();
  initSocket();
  globalThis.CRNS = { ui: new NetrunningSuiteApp() };

  await loadTemplates([
    "shell", "tree", "tabs", "arch-canvas", "editor", "runners", "actions", "actions-damagebox", "actions-target", "entity-card", "help", "content-editor",
  ].map(TPL));

  patchSortCombatants();
  await normalizeLegacyPids();
  loadProgramIcons().then(() => { if (globalThis.CRNS?.ui?.rendered) globalThis.CRNS.ui.render(false); });
  for (const actor of game.actors) observeRecorder(actor);
});
function observeRecorder(actor) {
  bridge.observeDeathSave(actor, data => {
    if (data.failed) notifyClients({ kind: "recorderDeath", ...data, eventId: foundry.utils.randomID(16) });
  });
}
Hooks.on("createActor", actor => observeRecorder(actor));
Hooks.on(`${MODULE_ID}.notify`, data => {
  if (data?.kind === "recorderDeath" && isPrimaryGM()) mutate("equipment.recordDeath", data);
});

/* ------------------------------------------------------------------ */
/* Turn-queue tie ordering (SPEC §14.1)                                */
/* ------------------------------------------------------------------ */

/** Idempotently monkey-patch Combat.prototype._sortCombatants so that equal
 *  initiatives are ordered by our `queueTs` flag DESC (most recently encountered
 *  ICE on top), falling back to the system/core comparator. The CPR system does
 *  not override _sortCombatants (verified), so we patch the CPRCombat prototype
 *  set at CONFIG.Combat.documentClass. */
function patchSortCombatants() {
  const cls = CONFIG?.Combat?.documentClass;
  const proto = cls?.prototype;
  if (!proto) return;
  if (proto._crnsSortPatched) return; // idempotent.
  const original = proto._sortCombatants;
  proto._sortCombatants = function crnsSortCombatants(a, b) {
    const ia = Number.isFinite(a?.initiative) ? a.initiative : -Infinity;
    const ib = Number.isFinite(b?.initiative) ? b.initiative : -Infinity;
    if (ia === ib) {
      const ta = Number(a?.getFlag?.(MODULE_ID, "queueTs")) || 0;
      const tb = Number(b?.getFlag?.(MODULE_ID, "queueTs")) || 0;
      if (ta !== tb) return tb - ta; // newer first.
    }
    return original.call(this, a, b);
  };
  proto._crnsSortPatched = true;
}

/* One-time data normalization: runner pids used to embed ":" ("actor:<uuid>"),
 * which broke every colon-delimited entityRef parser ("runner:<pid>",
 * "prog:<pid>:<programId>"). Re-key legacy participants to "a_<uuid>". */
async function normalizeLegacyPids() {
  if (!isPrimaryGM()) return;
  const session = getWorld("session") || {};
  const parts = session.participants || {};
  const legacy = Object.keys(parts).filter((k) => k.startsWith("actor:"));
  if (!legacy.length) return;
  const rename = {};
  for (const oldPid of legacy) {
    const newPid = `a_${oldPid.slice("actor:".length).replace(/[^\w-]/g, "_")}`;
    rename[oldPid] = newPid;
    parts[newPid] = parts[oldPid];
    delete parts[oldPid];
  }
  const pf = session.progFloors || {};
  for (const key of Object.keys(pf)) {
    const cut = key.lastIndexOf("|");
    if (cut < 0) continue;
    const pid = key.slice(0, cut);
    if (rename[pid]) {
      pf[`${rename[pid]}${key.slice(cut)}`] = pf[key];
      delete pf[key];
    }
  }
  const targets = session.targets || {};
  for (const [uid, ref] of Object.entries(targets)) {
    for (const [o, n] of Object.entries(rename)) {
      if (ref === `runner:${o}`) targets[uid] = `runner:${n}`;
      else if (ref.startsWith(`prog:${o}:`)) targets[uid] = `prog:${n}:${ref.slice(`prog:${o}:`.length)}`;
    }
  }
  await setWorld("session", session);
  console.log(`${MODULE_ID} | normalized ${legacy.length} legacy participant id(s)`);
}

/* ------------------------------------------------------------------ */
/* Scene-control toolbar button (SPEC §7.8)                            */
/* ------------------------------------------------------------------ */

Hooks.on("getSceneControlButtons", (controls) => {
  const token = controls.find((c) => c.name === "token");
  token?.tools.push({
    name: "crns",
    title: loc("CRNS.Button.Open"),
    icon: "fas fa-microchip",
    // The toolbar button is now visible to EVERYONE (SPEC §13 spectators rework):
    // the tab strip / spectator switcher is the in-app entry point. The JOIN is
    // still gated by allowSpectators server-side; only the button is unconditional.
    visible: true,
    onClick: () => globalThis.CRNS?.ui?.render(true),
    button: true,
  });
});

/* ------------------------------------------------------------------ */
/* Live re-render                                                      */
/* ------------------------------------------------------------------ */

const _rerenderDebounced = foundry.utils.debounce(() => {
  const app = globalThis.CRNS?.ui;
  if (app?.rendered) app.render(false);
}, 100);

function rerenderNow() { _rerenderDebounced(); }

Hooks.on("updateSetting", (setting) => {
  if (!setting.key?.startsWith(`${MODULE_ID}.`)) return;
  pruneDefenseRequests();
  _rerenderDebounced();
});

/** Whether an actor changing should re-render the suite: a session runner, an
 *  architecture entity actor (blackIce/demon referenced by any arch), or one the
 *  current user could act with. Used to filter actor/item hooks. */
function actorRelevant(actor) {
  if (!actor) return false;
  const session = getWorld("session") || {};
  const parts = session.participants || {};
  const uuid = actor.uuid;
  for (const p of Object.values(parts)) {
    if (p.kind === "runner" && p.actorUuid === uuid) return true;
  }
  if (actor.type === "blackIce" || actor.type === "demon") {
    if (Object.values(session.progState || {}).some(p => p.actorId === actor.id)) return true;
    if (archReferencesActor(actor.id)) return true;
  }
  return actor.testUserPermission?.(game.user, "OWNER") && eligibleNetrunner(actor);
}

/** Cheap scan of netArchs for a floor entity backed by this actor id. */
function archReferencesActor(actorId) {
  const archs = getWorld("netArchs") || {};
  for (const arch of Object.values(archs)) {
    for (const floor of arch.floors || []) {
      if ((floor.ice || []).some((i) => i.actorId === actorId)) return true;
      if (floor.demon?.actorId === actorId) return true;
    }
  }
  return false;
}

const _actorHook = (actor) => {
  const app = globalThis.CRNS?.ui;
  if (!app?.rendered) return;
  if (actorRelevant(actor)) _rerenderDebounced();
};
Hooks.on("updateActor", _actorHook);
Hooks.on("deleteActor", actor => {
  if (isPrimaryGM() && !actor.pack && !actor.isToken) mutate("session.documentDeleted", { actorId: actor.id });
});

const _itemHook = (item) => {
  const app = globalThis.CRNS?.ui;
  if (!app?.rendered) return;
  const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
  if (actorRelevant(actor)) _rerenderDebounced();
};
Hooks.on("createItem", _itemHook);
Hooks.on("updateItem", _itemHook);
Hooks.on("deleteItem", _itemHook);
Hooks.on("deleteItem", item => {
  if (isPrimaryGM() && item.type === "program" && item.parent?.documentName === "Actor" && !item.parent.pack) {
    mutate("session.documentDeleted", { actorUuid: item.parent.uuid, programId: item.id });
  }
});
Hooks.on("preUpdateItem", (item, changes) => {
  if (item.type !== "cyberdeck" || item.parent?.documentName !== "Actor") return;
  const next = changes["system.installedItems.list"] ?? changes.system?.installedItems?.list;
  if (!Array.isArray(next)) return;
  const removed = (item.system?.installedItems?.list || []).filter(id => !next.includes(id));
  if (removed.length) mutate("equipment.backupRemoved", { actorUuid: item.parent.uuid, driveIds: removed });
});
Hooks.on("preDeleteItem", item => {
  if (item.parent?.documentName === "Actor") mutate("equipment.backupRemoved", { actorUuid: item.parent.uuid, driveIds: [item.id] });
});

/* ------------------------------------------------------------------ */
/* Combat integration — reset a runner's NET actions on their turn      */
/* ------------------------------------------------------------------ */

function resetRunnerForCombatant(combat) {
  if (!isPrimaryGM() || combat?.id !== game.combat?.id) return;
  mutate("run.startTurn", { combatId: combat.id, round: combat.round, combatantId: combat.combatant?.id });
}
Hooks.on("combatTurnChange", (combat, previous, current) => {
  rerenderNow();
  if (!isPrimaryGM() || combat.id !== game.combat?.id) return;
  if (previous?.round === current?.round && previous?.combatantId === current?.combatantId) return;
  const prior = combat.combatants?.get(previous?.combatantId);
  const session = getWorld("session") || {};
  for (const [pid, part] of Object.entries(session.participants || {})) {
    const actor = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
    if (part.kind === "runner" && combatantMatchesActor(prior, part.actorUuid, actor?.id)) {
      mutate("equipment.turnEnd", { pid, key: `${combat.id}:${previous.round}:${previous.combatantId}` });
    }
  }
  resetRunnerForCombatant(combat);
});
Hooks.on("updateCombat", combat => { rerenderNow(); if (!combat.started) resetRunnerForCombatant(combat); });
Hooks.on("deleteCombat", rerenderNow);
for (const hook of ["createCombatant", "updateCombatant", "deleteCombatant"]) Hooks.on(hook, rerenderNow);

/* ------------------------------------------------------------------ */
/* Auto-roll: primary GM answers a player's attack (SPEC §8.4)          */
/* ------------------------------------------------------------------ */

const resolvingReactions = new Set();
const pendingDefenseRequests = new Map();

function defenseContextValid(data, session = getWorld("session") || {}) {
  const part = session.participants?.[data.pid];
  if (!part?.archId || part.jackedIn === false || (data.archId && data.archId !== part.archId)) return false;
  const owner = part.actorUuid ? fromUuidSync(part.actorUuid) : null;
  if (!owner) return false;
  if (data.progDefense?.programId && !owner.getOwnedItem?.(data.progDefense.programId)?.system?.isRezzed) return false;
  if (data.attackerProg?.pid) {
    const source = session.participants?.[data.attackerProg.pid];
    const actor = source?.actorUuid ? fromUuidSync(source.actorUuid) : null;
    if (!source || source.jackedIn === false || source.archId !== part.archId || !actor?.getOwnedItem?.(data.attackerProg.programId)) return false;
  }
  return true;
}

function pruneDefenseRequests() {
  const session = getWorld("session") || {};
  for (const [id, request] of pendingDefenseRequests) if (!defenseContextValid(request, session)) pendingDefenseRequests.delete(id);
  const app = globalThis.CRNS?.ui;
  if (app?._pendingDefense) app._pendingDefense = app._pendingDefense.filter(request => defenseContextValid(request, session));
}

function requestDefense(data) {
  const part = (getWorld("session") || {}).participants?.[data.pid];
  const request = { ...data, archId: part?.archId || "", defenseId: foundry.utils.randomID(16) };
  if (!defenseContextValid(request)) return;
  pruneDefenseRequests();
  if (data.attackerProg?.activationId && [...pendingDefenseRequests.values()].some(existing => existing.pid === request.pid
    && existing.targetRef === request.targetRef && existing.attackerProg?.activationId === data.attackerProg.activationId)) return;
  if (pendingDefenseRequests.size >= 256) pendingDefenseRequests.delete(pendingDefenseRequests.keys().next().value);
  pendingDefenseRequests.set(request.defenseId, foundry.utils.deepClone(request));
  notifyClients(request);
}
async function resolveReaction(key, callback) {
  if (resolvingReactions.has(key)) return;
  resolvingReactions.add(key);
  try { await callback(); }
  finally { resolvingReactions.delete(key); }
}

Hooks.on(`${MODULE_ID}.notify`, (data) => {
  if (data?.kind === "attackVisual") {
    if (globalThis.CRNS?.ui) play3DAttack(globalThis.CRNS.ui, data);
    return;
  }
  // Player-side defence prompt (SPEC Addendum 2): the OWNING player client shows
  // a defence prompt in the action bar; evaluated on every client (not GM-gated).
  if (data?.kind === "defenseRequest") {
    handleDefenseRequest(data);
    return;
  }
  if (!isPrimaryGM()) return;
  if (data?.kind === "rollRequest") {
    handleRollRequest(data).catch((e) => console.error(`${MODULE_ID} | rollRequest`, e));
  } else if (data?.kind === "speedTest") {
    resolveReaction(`speed:${data.testId}`, () => handleSpeedTest(data)).catch((e) => console.error(`${MODULE_ID} | speedTest`, e));
  } else if (data?.kind === "slideTest") {
    resolveReaction(`slide:${data.pid}`, () => handleSlideTest(data)).catch((e) => console.error(`${MODULE_ID} | slideTest`, e));
  } else if (data?.kind === "defenseResult") {
    handleDefenseResult(data).catch((e) => console.error(`${MODULE_ID} | defenseResult`, e));
  }
});

/** Client-side: if I own the targeted runner, record a pending defence prompt on
 *  the app and re-render so the action bar shows the "roll defence" block. */
function handleDefenseRequest(data) {
  const app = globalThis.CRNS?.ui;
  if (!app) return;
  const part = (getWorld("session") || {}).participants?.[data.pid];
  if (!part || part.userId !== game.user.id || !data.defenseId || !defenseContextValid(data)) return;
  app._pendingDefense = app._pendingDefense || [];
  if (app._pendingDefense.some(request => request.id === data.defenseId)) return;
  app._pendingDefense.push({
    id: data.defenseId,
    archId: data.archId,
    pid: data.pid,
    attackerName: data.attackerName || "",
    attackerTotal: Number(data.total) || 0,
    // Program-defence marker (item 2): when present the owner rolls the program's
    // own "def" execution (Interface + program DEF + 1d10) instead of Interface
    // defence, and the prompt names the defending program.
    progDefense: data.progDefense || null,
    progName: data.progName || "",
    // Carry the attacker program so the defence reply can trigger miss auto-derez.
    attackerProg: data.attackerProg || null,
    targetRef: data.targetRef || "",
  });
  if (app.rendered) app.render(false);
}

/** Resolve the ICE side of a Slide (SPEC §14.7). The runner initiated, so the
 *  runner succeeds only when runnerTotal STRICTLY exceeds the ICE's PER total
 *  (opposed, defender wins ties). `data.testRef` is the ICE ref; `data.pid` the
 *  runner; `data.runnerTotal` the runner's slide total. On success the ICE's
 *  attachment to this runner is dropped and a slid record stored. */
async function handleSlideTest(data) {
  const part = (getWorld("session") || {}).participants?.[data.pid];
  const attempt = part?.slideAttempt;
  if (part?.jackedIn === false || attempt?.targetRef !== data.testRef || !Number.isFinite(Number(data.runnerTotal))) return;
  const resolved = refToActor(data.testRef);
  if (!resolved?.actor || resolved.kind !== "ice") return;
  const iceActor = resolved.actor;

  const roll = await bridge.rollEntityStat(iceActor, "per");
  if (!roll || !isPrimaryGM()) return;
  const current = (getWorld("session") || {}).participants?.[data.pid];
  if (current?.jackedIn === false || current?.archId !== part.archId
    || current?.slideAttempt?.targetRef !== attempt.targetRef || current?.slideAttempt?.destination !== attempt.destination) return;
  const iceTotal = Number(roll?.resultTotal) || 0;
  const runnerTotal = Number(data.runnerTotal) || 0;

  // Runner initiates → success only when he EXCEEDS the ICE's PER (ties to ICE).
  const success = runnerTotal > iceTotal;

  const slideRunnerName = participantName(getWorld("session") || {}, data.pid);
  postComparisonCard(slideRunnerName, runnerTotal, iceActor.name, iceTotal, {
    title: loc("CRNS.Actions.Slide"),
    avoided: success, // reuse the titled variant: "avoided" = runner slid past.
    speedTest: true,
    slide: true,
  });

  if (success) {
    // Slide target is either an arch ICE (ice:archId:floorId:iceId) or a player
    // Black ICE (prog:<ownerPid>:<programId>) — resolve the right slideResolve
    // shape so the attachment + slid record use matching identity (Addendum 2).
    const testRef = data.testRef || "";
    if (testRef.startsWith("prog:")) {
      const rest = testRef.slice("prog:".length);
      const cut = rest.lastIndexOf(":");
      const ownerPid = rest.slice(0, cut);
      const programId = rest.slice(cut + 1);
      const st = (getWorld("session") || {}).progState?.[`${ownerPid}|${programId}`] || null;
      const archId = (getWorld("session") || {}).participants?.[data.pid]?.archId
        || (getWorld("session") || {}).participants?.[ownerPid]?.archId || "";
      if (st && archId) {
        await mutate("run.slideResolve", { archId, progKey: `${ownerPid}|${programId}`, pid: data.pid });
      }
    } else {
      const [, archId, , iceId] = testRef.split(":");
      await mutate("run.slideResolve", { archId, iceId, pid: data.pid });
    }
  } else {
    await mutate("run.clearSlideAttempt", { pid: data.pid, targetRef: data.testRef });
  }
}

/** Resolve the opposed side of a Black ICE attack-of-opportunity SPEED test
 *  (Corebook p.205). The runner's total arrives in `data.runnerTotal`; the GM
 *  rolls the ICE's SPD, compares (ties go to the RUNNER — he is defending), and
 *  on a runner loss posts the ICE's effect text. Then the test is cleared. */
async function handleSpeedTest(data) {
  const session = getWorld("session") || {};
  const test = (session.pendingTests || []).find((t) => t.id === data.testId);
  const part = session.participants?.[test?.pid];
  if (!test || (data.pid && data.pid !== test.pid) || !part?.archId || part.jackedIn === false || !Number.isFinite(Number(data.runnerTotal))) return;
  const iceActor = game.actors?.get(test.iceActorId);
  if (!iceActor) { await mutate("run.clearSpeedTest", { testId: data.testId }); return; }
  if (test.antiProgram) {
    const candidates = activeProgramRefs(session, test.pid, iceActor);
    if (!candidates.length) { await mutate("run.clearSpeedTest", { testId: test.id }); return; }
    if (!candidates.includes(test.targetRef)) test.targetRef = candidates[Math.floor(Math.random() * candidates.length)];
  }

  const roll = await bridge.rollEntityStat(iceActor, "spd");
  if (!roll || !isPrimaryGM()) return;
  const current = getWorld("session") || {};
  if (!(current.pendingTests || []).some((t) => t.id === test.id && t.iceActorId === test.iceActorId)
    || current.participants?.[test.pid]?.jackedIn === false || current.participants?.[test.pid]?.archId !== part.archId) return;
  const iceTotal = Number(roll?.resultTotal) || 0;
  const runnerTotal = Number(data.runnerTotal) || 0;
  const runnerName = participantName(session, test.pid);

  // Ties go to the RUNNER: he avoids the attack of opportunity unless the ICE
  // strictly exceeds his total.
  const avoided = runnerTotal >= iceTotal;

  postComparisonCard(test.iceName, iceTotal, runnerName, runnerTotal, {
    title: loc("CRNS.Actions.SpeedTest"),
    avoided,
    speedTest: true,
  });

  if (!avoided) {
    if (test.targetRef) {
      const current = (getWorld("session") || {}).targets?.[game.user.id];
      if (current !== test.targetRef) await mutate("session.setTarget", { entityRef: test.targetRef });
    }
    // The ICE's effect applies — post its effect text.
    const resolved = refToActor(test.ref);
    const effectKey = resolved?.type ? BLACK_ICE[resolved.type]?.effectKey : "";
    if (effectKey) postEffectCard(iceActor.id, `${effectKey}.effect`);
  }

  await mutate("run.clearSpeedTest", { testId: data.testId });
}

/** A participant's display name (backing actor's name, else the NPC label). */
function participantName(session, pid) {
  const part = (session.participants || {})[pid];
  const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  return actor?.name || loc("CRNS.Runners.NPC");
}

/** Post a styled effect chat card for an ICE actor (shared with the action bar). */
function postEffectCard(actorId, effectKey) {
  const actor = game.actors?.get(actorId);
  if (!actor || !effectKey) return;
  const content =
    `<div class="crns-chat-card"><div class="crns-chat-title">` +
    `<i class="fas fa-skull"></i> ${esc(actor.name)}</div>` +
    `<div class="crns-chat-body">${loc(effectKey)}</div></div>`;
  ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content });
}

/** Resolve an ice:/demon:/runner: ref to its backing actor + kind. */
function refToActor(ref) {
  const [kind, archId, floorId, entId] = (ref || "").split(":");
  if (kind === "ice" || kind === "demon") {
    const arch = (getWorld("netArchs") || {})[archId];
    const floor = (arch?.floors || []).find((f) => f.id === floorId);
    if (!floor) return null;
    const def = kind === "ice"
      ? (floor.ice || []).find((i) => i.id === entId)
      : (floor.demon && floor.demon.id === entId ? floor.demon : null);
    if (!def?.actorId) return null;
    return { kind, actor: game.actors?.get(def.actorId) ?? null, type: def.type };
  }
  if (kind === "runner") {
    const part = (getWorld("session") || {}).participants?.[archId]; // archId slot = pid here
    const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
    return actor ? { kind, actor, type: "" } : null;
  }
  // prog:<pid>:<programId> — a rezzed player Black-ICE backed by its own actor
  // (SPEC §14.12 / Task 1). pid may contain ":", so split off the trailing id.
  if (kind === "prog") {
    const rest = (ref || "").slice("prog:".length);
    const cut = rest.lastIndexOf(":");
    if (cut < 0) return null;
    const pid = rest.slice(0, cut);
    const programId = rest.slice(cut + 1);
    const ps = (getWorld("session") || {}).progState?.[`${pid}|${programId}`] || null;
    const actor = ps?.actorId ? (game.actors?.get(ps.actorId) ?? null) : null;
    // Treat as ICE for rolls. Derive a BLACK_ICE type from the actor name so the
    // effect card can resolve (empty for custom-named programs — caller skips).
    return actor ? { kind: "ice", actor, type: blackIceTypeForName(actor.name) } : null;
  }
  return null;
}

/** Is a runner participant PLAYER-controlled (owned by a non-GM user)? Such a
 *  defender must roll on THEIR OWN client so the standard CPR verify dialog opens
 *  (they can add LUCK). GM-controlled runners (userId "") auto-roll GM-side. */
function runnerIsPlayerControlled(pid) {
  const part = (getWorld("session") || {}).participants?.[pid];
  if (!part || part.kind !== "runner" || !part.userId) return false;
  const user = game.users.get(part.userId);
  return !!user && !user.isGM;
}

/** Parse a "prog:<pid>:<programId>" ref → { pid, programId } (pid may contain ":"). */
function parseProgRef(ref) {
  const rest = (ref || "").slice("prog:".length);
  const cut = rest.lastIndexOf(":");
  if (cut < 0) return null;
  return { pid: rest.slice(0, cut), programId: rest.slice(cut + 1) };
}

async function handleRollRequest(data) {
  const auto = game.settings.get(MODULE_ID, "autoRollNPC");

  // Program target (item 2): the attack targets a runner's rezzed program. The
  // program itself DEFENDS — Interface + program DEF + 1d10 (the system's
  // cyberdeck program "def" roll). If the owning runner is player-controlled,
  // prompt THAT player to roll it (standard dialog, LUCK available); otherwise
  // the GM auto-rolls it GM-side. This must NOT use the backing-actor "def" stat.
  if ((data.targetRef || "").startsWith("prog:")) {
    const parsed = parseProgRef(data.targetRef);
    if (!parsed) return;
    const { pid, programId } = parsed;
    const part = (getWorld("session") || {}).participants?.[pid];
    const owner = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
    if (!owner) return;

    // Player-owned → prompt the owning player to roll the program's defence.
    if (runnerIsPlayerControlled(pid)) {
      requestDefense({
        kind: "defenseRequest",
        pid,
        targetRef: data.targetRef,
        attackerName: data.attackerName || "",
        total: Number(data.total) || 0,
        // Program-defence marker: the owner rolls bridge.rollProgram(..,"def").
        progDefense: { programId },
        progName: owner.getOwnedItem?.(programId)?.name || "",
        attackerProg: data.attackerProg || null,
      });
      return;
    }

    // GM/NPC-owned program → auto-roll its defence GM-side (unless auto is off).
    if (!auto) {
      ui.notifications.info(loc("CRNS.Actions.AutoRollPrompt", { attacker: data.attackerName, target: owner.name }));
      return;
    }
    const roll = await bridge.rollProgram(owner, programId, "def");
    if (!roll || !isPrimaryGM() || !defenseContextValid({ pid, archId: part.archId, progDefense: { programId }, attackerProg: data.attackerProg })) return;
    const defenderTotal = Number(roll?.resultTotal) || 0;
    const progName = owner.getOwnedItem?.(programId)?.name || owner.name;
    postComparisonCard(data.attackerName, Number(data.total) || 0, progName, defenderTotal);
    postProgramAttackVisual(data, (Number(data.total) || 0) > defenderTotal);
    if ((Number(data.total) || 0) <= defenderTotal) await derezAttackerProg(data.attackerProg);
    return;
  }

  const resolved = refToActor(data.targetRef);
  if (!resolved?.actor) return;
  const { kind, actor } = resolved;

  // Player-owned runner defender (SPEC Addendum 2): do NOT auto-roll on the GM
  // client. Prompt the owning player to roll defence with the standard dialog.
  if (kind === "runner") {
    const pid = (data.targetRef || "").slice("runner:".length);
    if (runnerIsPlayerControlled(pid)) {
      requestDefense({
        kind: "defenseRequest",
        pid,
        targetRef: data.targetRef,
        attackerName: data.attackerName || "",
        total: Number(data.total) || 0,
        // Carry the attacker program through so the player's defence reply can
        // trigger the miss auto-derez (Requirement 3).
        attackerProg: data.attackerProg || null,
      });
      return;
    }
  }

  if (!auto) {
    ui.notifications.info(loc("CRNS.Actions.AutoRollPrompt", { attacker: data.attackerName, target: actor.name }));
    return;
  }

  let defenderTotal = 0;
  if (kind === "ice") {
    const roll = await bridge.rollEntityStat(actor, "def");
    if (!roll) return;
    defenderTotal = Number(roll?.resultTotal) || 0;
  } else if (kind === "demon") {
    // SPEC §14.8: demons now ROLL 1d10+Interface on defense (Combat Number stays
    // only as a separate manual action button on the demon panel).
    const roll = await bridge.rollEntityStat(actor, "interface");
    if (!roll) return;
    defenderTotal = Number(roll?.resultTotal) || 0;
  } else if (kind === "runner") {
    // GM-controlled runner (userId "") — auto-roll GM-side.
    const roll = await bridge.rollInterface(actor, "defense");
    if (!roll) return;
    defenderTotal = Number(roll?.resultTotal) || 0;
  }

  if (!isPrimaryGM() || refToActor(data.targetRef)?.actor?.id !== actor.id) return;
  if (kind === "runner" && !defenseContextValid({ pid: data.targetRef.slice(7), attackerProg: data.attackerProg })) return;
  postComparisonCard(data.attackerName, Number(data.total) || 0, actor.name, defenderTotal);
  postProgramAttackVisual(data, (Number(data.total) || 0) > defenderTotal);

  // Requirement 3: on a MISS (atk <= def) an attacker program auto-derezzes,
  // WITHOUT a damage roll. (On a hit the player rolls damage and the attacker
  // self-derezzes after that roll — existing, idempotent behaviour.)
  if ((Number(data.total) || 0) <= defenderTotal) {
    await derezAttackerProg(data.attackerProg);
  }
}

/** Requirement 3: derez the attacker program GM-side after a MISS. Resolves the
 *  owner actor from the participant pid, derezzes the program item, clears its
 *  rezzed mirror, and posts the AttackerDerez info as a chat card (not just a
 *  toast, so players see it). Idempotent — a program already derezzed is a
 *  no-op (no error, no double card). */
async function derezAttackerProg(attackerProg) {
  if (!attackerProg?.isAttacker) return;
  // Integrated activations finish immediately on the owner's client, independent
  // of whether damage is rolled or a deferred defence prompt is answered.
  if (attackerProg.activationId) return;
  const { pid, programId } = attackerProg;
  if (!pid || !programId) return;
  const part = (getWorld("session") || {}).participants?.[pid];
  const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  if (!actor) return;
  // Idempotency: only act (and post) when the program is still rezzed.
  const wasRezzed = !!actor.getOwnedItem?.(programId)?.system?.isRezzed;
  if (!wasRezzed) return;
  await bridge.derezProgram(actor, programId);
  await mutate("run.setRezzed", { pid, programId, state: null });
  const content =
    `<div class="crns-chat-card"><div class="crns-chat-title">` +
    `<i class="fas fa-arrow-rotate-left"></i> ${esc(actor.name)}</div>` +
    `<div class="crns-chat-body">${esc(loc("CRNS.Actions.AttackerDerez", { name: actor.name }))}</div></div>`;
  ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content });
}

/** Primary GM: a player rolled their defence (SPEC Addendum 2) — post the
 *  attacker-vs-defence comparison card (ties to defender, default rule). */
async function handleDefenseResult(data) {
  const request = pendingDefenseRequests.get(data.defenseId);
  if (!request || request.pid !== data.pid || !Number.isFinite(Number(data.defenseTotal))) return;
  pendingDefenseRequests.delete(data.defenseId);
  if (!defenseContextValid(request)) return;
  const part = (getWorld("session") || {}).participants?.[request.pid];
  const actor = part?.actorUuid ? (fromUuidSync?.(part.actorUuid) ?? null) : null;
  // Program defence (item 2): name the defending program; else the runner.
  const name = request.progName || actor?.name || loc("CRNS.Runners.NPC");
  const atk = Number(request.total) || 0;
  const def = Number(data.defenseTotal) || 0;
  postComparisonCard(request.attackerName || "", atk, name, def);
  postProgramAttackVisual(request, atk > def);
  // Requirement 3: attacker program auto-derezzes on a MISS (atk <= def).
  if (atk <= def) await derezAttackerProg(request.attackerProg);
}

/** Visual-only result: renderer resolves both endpoints from its permitted VM. */
function postProgramAttackVisual(data, hit) {
  const source = data.attackerProg;
  if (!source?.isAttacker || !data.targetRef) return;
  const session = getWorld("session") || {};
  const part = session.participants?.[source.pid];
  const owner = part?.actorUuid ? fromUuidSync(part.actorUuid) : null;
  const program = owner?.getOwnedItem?.(source.programId);
  if (!part?.jackedIn || !part.archId || !["antipersonnelattacker", "antiprogramattacker"].includes(program?.system?.class)) return;
  const ref = data.targetRef;
  const targetPid = ref.startsWith("runner:") ? ref.slice(7) : ref.startsWith("prog:") ? parseProgRef(ref)?.pid : "";
  if (targetPid && !session.participants?.[targetPid]?.jackedIn) return;
  const targetArch = targetPid ? session.participants?.[targetPid]?.archId : /^(ice|demon):/.test(ref) ? ref.split(":")[1] : "";
  const parsedTarget = ref.startsWith("prog:") ? parseProgRef(ref) : null;
  const targetUuid = parsedTarget && session.participants?.[parsedTarget.pid]?.actorUuid;
  const targetOwner = targetUuid ? fromUuidSync(targetUuid) : null;
  const exists = parsedTarget ? targetOwner?.getOwnedItem?.(parsedTarget.programId) : refToActor(ref)?.actor;
  if (targetArch !== part.archId || !exists) return;
  const id = source.activationId ? `${part.archId}:${source.pid}:${source.activationId}` : foundry.utils.randomID(12);
  notifyClients({ kind: "attackVisual", id, archId: part.archId,
    sourceRef: `prog:${source.pid}:${source.programId}`, ownerRef: `runner:${source.pid}`,
    targetRef: ref, programName: program.name, visual: bridge.programDefinition?.(program)?.visual, hit: hit === true });
}

/** Post the module comparison mini-card. Default (attack): the attacker must
 *  EXCEED the defender (ties go to the defender). SPEED-test variant (`opts`):
 *  a titled card whose verdict is "avoided"/"failed" for the runner, ties to
 *  the RUNNER (Corebook p.205). */
function postComparisonCard(attacker, atkTotal, defender, defTotal, opts = null) {
  let verdict, cls, note, title;
  if (opts?.slide) {
    verdict = opts.avoided ? loc("CRNS.Actions.SlidPast") : loc("CRNS.Actions.SlideBlocked");
    cls = opts.avoided ? "crns-hit" : "crns-miss";
    note = loc("CRNS.Actions.SlideTieNote");
    title = `${esc(opts.title || "")}: ${esc(attacker)} → ${esc(defender)}`;
  } else if (opts?.speedTest) {
    verdict = opts.avoided ? loc("CRNS.Actions.SpeedAvoided") : loc("CRNS.Actions.SpeedFailed");
    cls = opts.avoided ? "crns-hit" : "crns-miss";
    note = loc("CRNS.Actions.SpeedTieNote");
    title = `${esc(opts.title || "")}: ${esc(attacker)} → ${esc(defender)}`;
  } else {
    const hit = atkTotal > defTotal;
    verdict = hit ? loc("CRNS.Actions.Hit") : loc("CRNS.Actions.Miss");
    cls = hit ? "crns-hit" : "crns-miss";
    note = loc("CRNS.Actions.TieNote");
    title = `${esc(attacker)} → ${esc(defender)}`;
  }
  const content =
    `<div class="crns-chat-card crns-compare">` +
    `<div class="crns-chat-title">${title}</div>` +
    `<div class="crns-chat-body">${esc(attacker)}: <b>${atkTotal}</b> ` +
    `${loc("CRNS.Actions.Versus")} ${esc(defender)}: <b>${defTotal}</b></div>` +
    `<div class="crns-compare-verdict ${cls}">${verdict}</div>` +
    `<div class="crns-compare-note">${note}</div></div>`;
  ChatMessage.create({ user: game.user.id, content });
}

/* ------------------------------------------------------------------ */
/* Handlebars helpers (prefix crns)                                    */
/* ------------------------------------------------------------------ */

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("crnsEq", (a, b) => a === b);
  Handlebars.registerHelper("crnsOr", (a, b) => a || b);
  Handlebars.registerHelper("crnsAnd", (a, b) => a && b);
  Handlebars.registerHelper("crnsIncludes", (arr, v) => Array.isArray(arr) && arr.includes(v));
  Handlebars.registerHelper("crnsConcat", (...args) => args.slice(0, -1).join(""));
  Handlebars.registerHelper("crnsGt", (a, b) => Number(a) > Number(b));
}
