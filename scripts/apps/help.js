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
import { visibleFloorIds } from "../topology.js";
import { equipmentProfile, equipmentHint } from "../equipment.js";
import { EQUIPMENT_CATALOG, REFERENCE_GROUPS, EQUIPMENT_LABELS, equipmentText, equipmentSource } from "../reference-catalog.js";
import { programIcon } from "../program-icons.js";
import { rulesReference } from "../rules-reference.js";

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
  const visible = visibleFloorIds(session, me.pid, arch);
  floors.forEach((floor) => {
    if (!visible.has(floor.id)) return;
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
    for (const [key, info] of Object.entries(PROGRAM_INFO)) {
      if (String(prog?.name).toLowerCase() === loc(`CRNS.Program.${info.key}.name`).toLowerCase()) out.add(key);
    }
  }
  return out;
}

export function getData(app) {
  const litIce = visibleIceTypes(app);
  const litProg = installedProgramNames();
  const actor = userNetrunnerActor(game.user);
  const deck = actor ? getDeck(actor) : null;
  const profile = equipmentProfile(actor, deck);
  const language = game.i18n.lang === "ru" ? "ru" : "en";
  const helpLabel = (key, fallback) => {
    const value = loc(`CRNS.Help.${key}`);
    return value && value !== `CRNS.Help.${key}` ? value : fallback;
  };
  const equipmentLabel = (key, fallback) => {
    const value = loc(`CRNS.Equipment.${key}`);
    return value && value !== `CRNS.Equipment.${key}` ? value : fallback;
  };
  const equipmentGroups = REFERENCE_GROUPS.map((group) => ({
    key: group, name: equipmentLabel(`Groups.${group}`, EQUIPMENT_LABELS[language].Groups[group]),
    entries: EQUIPMENT_CATALOG.filter((e) => e.group === group).map((e) => ({
      key: e.key, name: equipmentText(e.key, "name", language, loc),
      search: [e.key, ...e.aliases, e.name.en, e.name.ru].join(" "),
      effect: equipmentText(e.key, "effect", language, loc), source: equipmentSource(e.key, language),
      tooltip: equipmentHint(e.key, language, loc), framed: profile.keys.includes(e.key),
      installedLabel: equipmentLabel("Installed", EQUIPMENT_LABELS[language].Installed)
    }))
  }));

  const iceEntry = (key) => {
    const bi = BLACK_ICE[key] || {};
    const pk = icePascal(key);
    return {
      key,
      search: key,
      img: programIcon(key, ENTITY_ICONS[key] || "icons/svg/mystery-man.svg"),
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
      search: `${nameKey} ${info.key}`,
      code: abbrFor(nameKey),
      img: programIcon(nameKey),
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
      search: key,
      img: ENTITY_ICONS[key] || "icons/svg/mystery-man.svg",
      name: loc(`CRNS.Demon.${key}.name`),
      rez: d.rez ?? 0, interface: d.interface ?? 0, actions: d.actions ?? 0, cn: d.combatNumber ?? 0,
    };
  };

  return {
    help: {
      rules: rulesReference(game.i18n.lang).map((rule) => ({
        ...rule, search: rule.id, compact: Boolean(rule.summary || rule.points?.length || rule.example || rule.table)
      })),
      searchQuery: String(app.state.helpQuery ?? ""),
      searchLabel: helpLabel("Search", language === "ru" ? "Поиск" : "Search"),
      searchPlaceholder: helpLabel("SearchPlaceholder", language === "ru" ? "Название, эффект или ключ" : "Name, effect or key"),
      clearSearchLabel: helpLabel("ClearSearch", language === "ru" ? "Очистить" : "Clear"),
      noResultsLabel: helpLabel("NoResults", language === "ru" ? "Ничего не найдено." : "No results."),
      catalogActive: app.state.helpTab !== "rules", rulesActive: app.state.helpTab === "rules",
      tabPrefix: `crns-help-${app.appId ?? "suite"}`,
      catalogLabel: helpLabel("Catalog", language === "ru" ? "Каталог" : "Catalog"),
      rulesLabel: helpLabel("Rules", language === "ru" ? "Правила" : "Rules"),
      equipmentTitle: equipmentLabel("Title", EQUIPMENT_LABELS[language].Title), equipmentGroups,
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
  app._helpKeyCleanup?.();
  const overlay = html.find(".crns-help-overlay")[0];
  const openButton = html.find('[data-action="help-open"]')[0];
  const tabs = Array.from(overlay?.querySelectorAll("[data-help-tab]") || []);
  const selectTab = (key, focus = false) => {
    app.state.helpTab = key === "rules" ? "rules" : "catalog";
    for (const tab of tabs) {
      const active = tab.dataset.helpTab === app.state.helpTab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus({ preventScroll: true });
    }
    for (const panel of overlay?.querySelectorAll("[data-help-panel]") || []) panel.hidden = panel.dataset.helpPanel !== app.state.helpTab;
  };
  html.find("[data-help-tab]").on("click", (ev) => {
    ev.stopPropagation();
    selectTab(ev.currentTarget.dataset.helpTab, true);
  });
  html.find("[data-help-tab]").on("keydown", (ev) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault(); ev.stopPropagation();
    const index = tabs.indexOf(ev.currentTarget);
    const next = ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1
      : (index + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next].dataset.helpTab, true);
  });
  selectTab(app.state.helpTab);
  const searchInput = overlay?.querySelector("[data-help-search-input]");
  const normalize = (value) => String(value).normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
  const entries = Array.from(overlay?.querySelectorAll(".crns-help-entry, .crns-help-rule") || [])
    .map((node) => ({ node, text: normalize(`${node.dataset.helpSearch || ""} ${node.textContent}`) }));
  const groups = Array.from(overlay?.querySelectorAll("[data-help-group]") || []);
  const filter = () => {
    app.state.helpQuery = searchInput?.value ?? "";
    const terms = app.state.helpQuery.trim().split(/\s+/).map(normalize).filter(Boolean);
    for (const { node, text } of entries) node.hidden = !terms.every((term) => text.includes(term));
    for (const group of groups) {
      const rows = Array.from(group.querySelectorAll(".crns-help-entry"));
      const count = rows.filter((row) => !row.hidden).length;
      group.hidden = count === 0;
      group.querySelector(".crns-help-count").textContent = String(count);
    }
    for (const heading of overlay?.querySelectorAll("[data-help-heading]") || []) {
      heading.hidden = groups.filter((group) => group.dataset.helpGroup.startsWith(heading.dataset.helpHeading)).every((group) => group.hidden);
    }
    for (const panel of overlay?.querySelectorAll("[data-help-panel]") || []) {
      panel.querySelector("[data-help-empty]").hidden = Array.from(panel.querySelectorAll(".crns-help-entry, .crns-help-rule")).some((node) => !node.hidden);
    }
  };
  html.find("[data-help-search-input]").on("input", filter);
  html.find('[data-action="help-search-clear"]').on("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    searchInput.value = "";
    filter();
    searchInput.focus({ preventScroll: true });
  });
  if (searchInput) searchInput.value = String(app.state.helpQuery ?? "");
  filter();
  const openOverlay = (focus = true) => {
    app.state.helpOpen = true;
    overlay?.classList.add("open");
    overlay?.setAttribute("aria-hidden", "false");
    openButton?.setAttribute("aria-expanded", "true");
    overlay?.ownerDocument.addEventListener("keydown", onKey, true);
    if (focus) overlay?.focus({ preventScroll: true });
  };
  const closeOverlay = () => {
    app.state.helpOpen = false;
    overlay?.classList.remove("open");
    overlay?.setAttribute("aria-hidden", "true");
    openButton?.setAttribute("aria-expanded", "false");
    overlay?.ownerDocument.removeEventListener("keydown", onKey, true);
    openButton?.focus({ preventScroll: true });
  };

  html.find('[data-action="help-open"]').on("click", (ev) => { ev.stopPropagation(); openOverlay(); });
  html.find('[data-action="help-close"]').on("click", (ev) => { ev.stopPropagation(); closeOverlay(); });
  // Click on the dimmed backdrop (outside the panel) closes it.
  html.find(".crns-help-overlay").on("click", (ev) => {
    if (ev.target === ev.currentTarget) closeOverlay();
  });
  // Escape closes the overlay (only while it is open, and before the app's own
  // Escape-clears-selection handler in suite-app).
  const onKey = (ev) => {
    const inSuite = overlay?.closest(".crns-root")?.contains(ev.target) || ev.target === overlay?.ownerDocument.body;
    if (ev.key === "Escape" && overlay?.isConnected && overlay.classList.contains("open") && inSuite) {
      ev.preventDefault();
      ev.stopPropagation();
      closeOverlay();
    }
  };
  // Auto-renders can remove the focused node; Escape must still work from body.
  app._helpKeyCleanup = () => overlay?.ownerDocument.removeEventListener("keydown", onKey, true);
  if (app.state.helpOpen) openOverlay(false);
}
