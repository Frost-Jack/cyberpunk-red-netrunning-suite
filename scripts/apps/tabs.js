/* Open-architecture tab strip. Phase B.
 * GM: strip of open archs from session.tabs (activate, edit-toggle, close).
 * Players: an always-visible watch picker, independent of their runner roster. */

import { MODULE_ID, loc } from "../constants.js";
import { getWorld, mutate, hasOp, isSpectatableRunner } from "../data.js";

export function getData(app) {
  const session = getWorld("session") || {};
  const archs = getWorld("netArchs") || {};

  if (game.user.isGM) {
    const editorArchId = app.state.editorArchId || "";
    const tabs = (session.tabs || [])
      .filter((id) => archs[id])
      .map((id) => ({
        archId: id,
        name: archs[id].name,
        active: session.activeTab === id,
        editing: editorArchId === id,
      }));
    return { tabsGM: { tabs } };
  }

  let allowSpectators = false, freeMove = false;
  try { allowSpectators = !!game.settings.get(MODULE_ID, "allowSpectators"); } catch (e) { /* noop */ }
  try { freeMove = !!game.settings.get(MODULE_ID, "spectatorFreeMove"); } catch (e) { /* noop */ }
  const me = app.myParticipant();
  const parts = session.participants || {};
  const spectator = Object.entries(parts).find(([, p]) => p.kind === "spectator" && p.userId === game.user.id);
  const hasOwnRunner = Object.values(parts).some((p) => p.kind === "runner" && p.userId === game.user.id);
  const currentArch = me?.kind === "spectator" ? me.archId : "";
  const targets = Object.entries(parts)
    .filter(([, p]) => isSpectatableRunner(p, archs))
    .map(([pid, p]) => {
      const actor = p.actorUuid ? (fromUuidSync?.(p.actorUuid) ?? null) : null;
      const switchLocked = !freeMove && !!currentArch && currentArch !== p.archId;
      return {
        pid, archId: p.archId,
        name: actor?.name || game.users.get(p.userId)?.name || loc("CRNS.Runners.NPC"),
        archName: archs[p.archId].name,
        active: me?.kind === "spectator" && me.followPid === pid,
        disabled: !allowSpectators || switchLocked,
      };
    });
  return { tabsWatch: {
    open: !!app.state.watchOpen,
    targets,
    permissionDenied: !allowSpectators,
    switchLocked: !freeMove && !!currentArch,
    canLeave: !!spectator,
    spectatorPid: spectator?.[0] || "",
    hasOwnRunner,
  } };
}

export function activateListeners(app, html) {
  if (game.user.isGM) {
    html.find('[data-action="tab-activate"]').on("click", (ev) => {
      if (ev.target.closest('[data-action]') !== ev.currentTarget) return;
      const archId = ev.currentTarget.dataset.archId;
      if (app.state.editorArchId && app.state.editorArchId !== archId) {
        app.state.editorArchId = "";
        app.state.draft = {};
      }
      mutate("tabs.activate", { archId });
    });
    html.find('[data-action="tab-edit"]').on("click", (ev) => {
      ev.stopPropagation();
      const archId = ev.currentTarget.closest("[data-arch-id]")?.dataset.archId;
      if (app.state.editorArchId === archId) {
        app.state.editorArchId = "";
        app.state.draft = {};
      } else {
        app.state.editorArchId = archId;
        app.state.draft = foundry.utils.deepClone((getWorld("netArchs") || {})[archId] || {});
        mutate("tabs.activate", { archId });
      }
      app.render(false);
    });
    html.find('[data-action="tab-close"]').on("click", (ev) => {
      ev.stopPropagation();
      const archId = ev.currentTarget.closest("[data-arch-id]")?.dataset.archId;
      if (app.state.editorArchId === archId) {
        app.state.editorArchId = "";
        app.state.draft = {};
      }
      mutate("tabs.close", { archId });
    });
    return;
  }

  html.find('[data-action="watch-toggle"]').on("click", () => {
    app.state.watchOpen = !app.state.watchOpen;
    app.render(false);
  });
  html.find('[data-action="spectate-switch"]').on("click", async (ev) => {
    const archId = ev.currentTarget.dataset.archId;
    const followPid = ev.currentTarget.dataset.followPid;
    if (!hasOp("session.spectate")) return;
    const result = await mutate("session.spectate", { userId: game.user.id, archId, followPid });
    if (result?.error) { ui.notifications.warn(loc(result.error)); return; }
    if (result !== true) return;
    app.state.watchOpen = false;
    app.state.selection = "";
    app.hovered = "";
    app.render(false);
  });
  html.find('[data-action="spectate-leave"]').on("click", async (ev) => {
    const session = getWorld("session") || {};
    const pid = ev.currentTarget.dataset.pid;
    const part = session.participants?.[pid];
    if (part?.kind !== "spectator" || part.userId !== game.user.id) return;
    const result = await mutate("session.disconnect", { pid });
    if (result !== true) return;
    app.state.watchOpen = false;
    app.state.selection = "";
    app.hovered = "";
    app.render(false);
  });
}
