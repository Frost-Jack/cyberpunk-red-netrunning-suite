import { MODULE_ID, loc, esc } from "../constants.js";
import { getWorld, mutate } from "../data.js";
import * as bridge from "../cpr-bridge.js";
import { equipmentProfile, equipmentHint } from "../equipment.js";

function runner(app, session) {
  const selection = (app.state.selection || "").split(":");
  const pid = game.user.isGM && ["runner", "prog"].includes(selection[0]) ? selection[1] : app.myParticipant()?.pid;
  const part = session.participants?.[pid];
  const actor = part?.kind === "runner" && part.actorUuid ? fromUuidSync(part.actorUuid) : null;
  return actor ? { pid, part, actor } : null;
}
export function getData(app) {
  return { equipmentAvailable: !!runner(app, getWorld("session") || {}) };
}
export function activateListeners(app, html) {
  html.find('[data-action="equipment-open"]').on("click", ev => {
    ev.preventDefault();
    const session = getWorld("session") || {}, selected = runner(app, session);
    if (!selected) return;
    const { actor, pid } = selected, deck = bridge.getDeck(actor), profile = equipmentProfile(actor, deck);
    const state = session.equipment?.[pid] || {};
    const cards = profile.keys.map(key => `<p title="${esc(equipmentHint(key, game.i18n.lang))}">${esc(equipmentHint(key, game.i18n.lang).split("\n")[0])}</p>`).join("");
    const actions = [
      ["scout", profile.freePathfinder && state.scoutPending && (selected.part.scoutActionSerial || 0) === (state.scoutSerial || 0), "Scout"],
      ["swifty", profile.swiftyClean && !state.swiftyUsed, "Swifty"],
      ["restore", profile.backupDrive && Object.keys(state.backups || {}).length > 0, "Restore"],
      ["smithy", profile.smithy, "Smithy"],
      ["extinguish", selected.part.netEffects?.fire, "Extinguish"],
    ].filter(([, available]) => available);
    const buttons = Object.fromEntries(actions.map(([action, , key]) => [action, {
      label: loc(`CRNS.Equipment.${key}`), callback: async () => {
        const result = action === "scout" ? { ok: true, ability: "pathfinder" } : await mutate("equipment.action", { pid, action });
        if (result?.error) { ui.notifications.warn(loc(result.error)); return; }
        if (!result?.ok) return;
        if (result.ability) {
          const totals = [];
          for (let n = 0; n < (result.rolls || 1); n++) {
            // A real click-like event opens CPR's normal confirmation/LUCK dialog.
            const roll = await bridge.rollInterface(actor, result.ability, { type: "click", ctrlKey: false, metaKey: false }, action === "scout" ? async () => {
              const claim = await mutate("equipment.action", { pid, action });
              if (claim?.error) ui.notifications.warn(loc(claim.error));
              return claim?.ok === true;
            } : undefined);
            if (roll) totals.push(Number(roll.resultTotal) || 0);
          }
          if (totals.length) await mutate("run.abilityResult", { pid, ability: result.ability, total: Math.max(...totals) });
          else if (action === "swifty") await mutate("equipment.action", { pid, action: "swiftyCancel" });
        }
      },
    }]));
    if (profile.cyberConductor) buttons.switch = {
      label: loc("CRNS.Equipment.Switch"), callback: () => {
        const decks = Array.from(actor.items?.contents || actor.items?.values?.() || []).filter(i => i.type === "cyberdeck" && i.id !== deck?.id);
        new Dialog({ title: loc("CRNS.Equipment.Switch"),
          content: `<select name="deck">${decks.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select>`,
          buttons: { switch: { label: loc("CRNS.Equipment.Switch"), callback: async html => {
            const result = await mutate("equipment.action", { pid, action: "switch", deckId: html.find('[name="deck"]').val() });
            if (result?.error) ui.notifications.warn(loc(result.error));
          } }, cancel: { label: loc("CRNS.Equipment.Close") } }, default: "cancel" }).render(true);
      },
    };
    buttons.close = { label: loc("CRNS.Equipment.Close") };
    new Dialog({ title: `${loc("CRNS.Equipment.Title")} — ${actor.name}`,
      content: `<section class="crns-equipment-dialog"><h3>${esc(deck?.name || "")}</h3>${cards || `<p>${esc(loc("CRNS.Equipment.None"))}</p>`}<p>${esc(loc("CRNS.Equipment.Range"))}: ${profile.range} m${profile.rangeRequiresGM ? ` · ${esc(loc("CRNS.Content.RangeGM"))}` : ""}</p><p>${esc(loc("CRNS.Equipment.Meat"))}</p></section>`,
      buttons, default: "close" }, { width: 600 }).render(true);
  });
}
