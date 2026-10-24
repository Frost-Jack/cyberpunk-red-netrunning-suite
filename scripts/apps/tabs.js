/* Open-architecture tab strip. Phase B.
 * GM: strip of open archs from session.tabs (activate, edit-toggle, close).
 * Players (runners): no tabs (locked to their arch).
 * Spectators: a plain switcher of runner-occupied archs when spectatorFreeMove. */

import { MODULE_ID } from "../constants.js";
import { getWorld, mutate, hasOp, playerRunnerArchIds } from "../data.js";

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

  // Spectator switcher. Shown to any non-GM user WITHOUT a runner participant
  // when spectating is allowed — including users with no participant record yet
  // (the record is only created by their first session.spectate, so gating on
  // an existing spectator record made joining impossible). With free-move off,
  // the switcher is only offered while they have no arch yet (initial join —
  // mirrors the op's server-side gate); afterwards they are locked in.
  let allowSpectators = false, freeMove = false;
  try { allowSpectators = !!game.settings.get(MODULE_ID, "allowSpectators"); } catch (e) { /* noop */ }
  try { freeMove = !!game.settings.get(MODULE_ID, "spectatorFreeMove"); } catch (e) { /* noop */ }
  const me = app.myParticipant();
  const spectatorCapable = allowSpectators && me?.kind !== "runner";
  const mayPick = freeMove || !(me?.archId);
  if (spectatorCapable && mayPick && hasOp("session.spectate")) {
    // Only archs holding a PLAYER-owned runner are spectatable (SPEC §13) —
    // spectators watch players, not GM/NPC-run architectures.
    const list = playerRunnerArchIds(session)
      .filter((id) => archs[id])
      .map((id) => ({ archId: id, name: archs[id].name, active: (me?.archId || "") === id }));
    if (list.length) return { tabsSpectator: { tabs: list } };
  }
  return {};
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

  // Spectator switcher.
  html.find('[data-action="spectate-switch"]').on("click", (ev) => {
    const archId = ev.currentTarget.dataset.archId;
    if (hasOp("session.spectate")) mutate("session.spectate", { userId: game.user.id, archId });
  });
}
