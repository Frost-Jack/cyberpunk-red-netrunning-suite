/* Reference/help overlay (SPEC §13 Item 1). A submodule of the suite shell: an
 * in-app overlay (NOT a Foundry Dialog) listing every Black ICE, program and
 * demon with stats + effect text. Entries get an accent HIGHLIGHT FRAME when
 * relevant to the viewing player:
 *   - an ICE entry when that ICE type is currently VISIBLE to them on their
 *     architecture (their visible floors — the same fog as the canvas: GM sees
 *     the ACTIVE arch; a player runner sees visited+revealed floors);
 *   - a program entry when a program of that name is INSTALLED in their own
 *     equipped cyberdeck.
 *
 * The overlay markup is always rendered (hidden) and toggled by a CSS `open`
 * class purely client-side (no re-render), so the highlight frames stay fresh
 * with every shell render. */

import { BLACK_ICE, DEMONS, PROGRAM_INFO, ENTITY_ICONS, abbrFor, loc } from "../constants.js";
import { getWorld } from "../data.js";
import { getDeck, installedPrograms, userNetrunnerActor } from "../cpr-bridge.js";

/* Ordering for the two Black-ICE groups (SPEC Item 1). */
const ICE_ANTI_NETRUNNER = ["asp", "giant", "hellhound", "kraken", "liche", "raven", "scorpion", "skunk", "wisp"];
const ICE_ANTI_PROGRAM = ["dragon", "killer", "sabertooth"];
const DEMON_ORDER = ["imp", "efreet", "balron"];

/** The lang sub-key for a BLACK_ICE key ("asp" → "Asp"). */
const icePascal = (key) => key.charAt(0).toUpperCase() + key.slice(1);

/** The set of BLACK_ICE type keys currently VISIBLE to the viewer, mirroring the
 *  canvas fog: GM → every type present in the ACTIVE arch; player runner → types
 *  on their visible floors (index ≤ visibleMax). Spectators/no-runner → empty. */
function visibleIceTypes(app) {
  const session = getWorld("session") || {};
  const archs = getWorld("netArchs") || {};
  const out = new Set();

  if (game.user.isGM) {
    const archId = app.state.editorArchId || session.activeTab || "";
    const arch = archs[archId];
    if (!arch) return out;
    for (const floor of arch.floors || []) {
      for (const ice of floor.ice || []) if (ice.type) out.add(String(ice.type).toLowerCase());
    }
    return out;
  }

  // Player runner: reuse the canvas fog (visited + revealed, never below floor).
  const me = app.myParticipant?.();
  if (me?.kind !== "runner" || !me.archId) return out;
  const arch = archs[me.archId];
  if (!arch) return out;
  const floors = arch.floors || [];
  const myFloor = Number(me.floorIndex) || 0;
  const visited = Number(me.maxFloor) || 0;
  const revealed = (session.reveal || {})[me.pid]?.[me.archId];
  let visibleMax = Math.max(visited, Number.isInteger(revealed) ? revealed : -1, myFloor);
  floors.forEach((floor, index) => {
    if (index > visibleMax) return;
    for (const ice of floor.ice || []) if (ice.type) out.add(String(ice.type).toLowerCase());
  });
  return out;
}

/** Lowercased names of every program installed in the viewer's own cyberdeck. */
function installedProgramNames() {
  const out = new Set();
  const actor = userNetrunnerActor(game.user);
  const deck = actor ? getDeck(actor) : null;
  if (!deck) return out;
  for (const prog of installedPrograms(deck) || []) {
    if (prog?.name) out.add(String(prog.name).toLowerCase());
  }
  return out;
}

export function getData(app) {
  const litIce = visibleIceTypes(app);
  const litProg = installedProgramNames();

  const iceEntry = (key) => {
    const bi = BLACK_ICE[key] || {};
    const pk = icePascal(key);
    return {
      key,
      img: ENTITY_ICONS[key] || "icons/svg/mystery-man.svg",
      name: loc(`CRNS.Ice.${pk}.name`),
      per: bi.per ?? 0, spd: bi.spd ?? 0, atk: bi.atk ?? 0, def: bi.def ?? 0, rez: bi.rez ?? 0,
      effect: loc(`CRNS.Ice.${pk}.effect`),
      framed: litIce.has(key),
    };
  };

  const progEntry = (nameKey) => {
    const info = PROGRAM_INFO[nameKey];
    return {
      key: info.key,
      code: abbrFor(nameKey),
      name: loc(`CRNS.Program.${info.key}.name`),
      atk: info.atk, def: info.def, rez: info.rez,
      effect: loc(`CRNS.Program.${info.key}.effect`),
      // Frame if a program of this name is installed in the viewer's deck.
      framed: litProg.has(nameKey),
    };
  };

  // Programs grouped by class, in canonical order.
  const byGroup = { booster: [], defender: [], attacker: [] };
  for (const nameKey of Object.keys(PROGRAM_INFO)) {
    byGroup[PROGRAM_INFO[nameKey].group].push(progEntry(nameKey));
  }

  const demonEntry = (key) => {
    const d = DEMONS[key] || {};
    return {
      key,
      img: ENTITY_ICONS[key] || "icons/svg/mystery-man.svg",
      name: loc(`CRNS.Demon.${key}.name`),
      rez: d.rez ?? 0, interface: d.interface ?? 0, actions: d.actions ?? 0, cn: d.combatNumber ?? 0,
    };
  };

  return {
    help: {
      iceAntiNetrunner: ICE_ANTI_NETRUNNER.map(iceEntry),
      iceAntiProgram: ICE_ANTI_PROGRAM.map(iceEntry),
      boosters: byGroup.booster,
      defenders: byGroup.defender,
      attackers: byGroup.attacker,
      demons: DEMON_ORDER.map(demonEntry),
    },
  };
}

export function activateListeners(app, html) {
  const overlay = html.find(".crns-help-overlay")[0];
  const openOverlay = () => { overlay?.classList.add("open"); };
  const closeOverlay = () => { overlay?.classList.remove("open"); };

  html.find('[data-action="help-open"]').on("click", (ev) => { ev.stopPropagation(); openOverlay(); });
  html.find('[data-action="help-close"]').on("click", (ev) => { ev.stopPropagation(); closeOverlay(); });
  // Click on the dimmed backdrop (outside the panel) closes it.
  html.find(".crns-help-overlay").on("click", (ev) => {
    if (ev.target === ev.currentTarget) closeOverlay();
  });
  // Escape closes the overlay (only while it is open, and before the app's own
  // Escape-clears-selection handler in suite-app).
  const onKey = (ev) => {
    if (ev.key === "Escape" && overlay?.classList.contains("open")) {
      ev.stopPropagation();
      closeOverlay();
    }
  };
  overlay?.addEventListener("keydown", onKey);
  // The overlay itself is focusable so Escape reaches it even when the backdrop
  // has focus; the button that opened it also focuses the overlay.
  html.find('[data-action="help-open"]').on("click", () => overlay?.focus?.({ preventScroll: true }));
}
