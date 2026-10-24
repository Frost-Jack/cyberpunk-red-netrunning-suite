import { MODULE_ID, esc } from "./constants.js";

export const CONTENT_CLASSES = ["booster", "defender", "antipersonnelattacker", "antiprogramattacker", "blackice"];
export const CONTENT_MODELS = ["runner", "asp", "giant", "hellhound", "kraken", "liche", "raven", "scorpion", "skunk", "wisp", "dragon", "killer", "sabertooth", "imp", "efreet", "balron", "rocklobster", "armor", "shield", "flak", "speedygonzalvez", "worm", "seeya", "eraser", "vrizzbolt", "sword", "banhammer", "deckkrash", "hellbolt", "nervescrub", "poisonflatline", "superglue", "unknown"];
export const CONTENT_ANIMATIONS = ["auto", "none", "sword", "banhammer", "deckkrash", "hellbolt", "nervescrub", "poisonflatline", "superglue", "vrizzbolt"];
export const CONTENT_EFFECTS = ["ignite", "forceJackOut", "randomDestroy", "randomNonIce", "raven", "emp", "disableDeck", "destroy", "manual"];

const text = (value, max) => String(value ?? "").slice(0, max);
const fail = () => { throw new Error("CRNS.Content.Invalid"); };
function integer(value, max = 100, min = 0) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < min || n > max) fail();
  return n;
}
function formula(value) {
  const result = text(value, 60).replace(/\s/g, "");
  if (result && !/^(?:[1-9]\d?d(?:[2-9]|[1-9]\d{1,2})|\d{1,4})(?:[+-](?:[1-9]\d?d(?:[2-9]|[1-9]\d{1,2})|\d{1,4}))*$/i.test(result)) fail();
  return result;
}
function image(value) {
  const result = text(value, 1024).trim();
  if (result && (/^[a-z][a-z\d+.-]*:/i.test(result) ? !/^https?:\/\//i.test(result)
    : result.startsWith("//") || result.includes("\\") || result.split("/").includes(".."))) fail();
  if (/[\x00-\x1f]/.test(result)) fail();
  return result;
}

/** Rebuild only known fields; imports never contain executable effects or document IDs. */
export function normalizeContent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) fail();
  const id = text(input.id, 64);
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) fail();
  const kind = input.kind;
  if (!["program", "blackIce", "demon"].includes(kind)) fail();
  const name = text(input.name, 120).trim();
  if (!name) fail();
  const cls = input.class || (kind === "program" ? "defender" : "antipersonnel");
  if (!(kind === "program" ? CONTENT_CLASSES : kind === "blackIce" ? ["antipersonnel", "antiprogram", "other"] : ["antipersonnel"]).includes(cls)) fail();
  const stats = {};
  for (const key of ["per", "spd", "atk", "def", "rez", "interface", "actions", "combatNumber"]) stats[key] = integer(input.stats?.[key], key === "rez" ? 10000 : 100);
  const antiProgram = cls.includes("antiprogram") || (cls === "blackice" && input.blackIceType === "antiprogram");
  const targets = input.targets || (antiProgram ? ["program", "blackIce", "demon"] : ["runner"]);
  if (!Array.isArray(targets) || targets.length > 4 || targets.some(t => !["runner", "program", "blackIce", "demon"].includes(t))) fail();
  if (targets.some(t => antiProgram ? t === "runner" : t !== "runner")) fail();
  if ((kind === "blackIce" || cls.includes("attacker") || cls === "blackice") && !targets.length) fail();
  if (input.effects !== undefined && (!Array.isArray(input.effects) || input.effects.length > 12)) fail();
  const effects = (input.effects || []).map(effect => {
    if (!effect || !CONTENT_EFFECTS.includes(effect.type)) fail();
    return { type: effect.type, description: text(effect.description, 2000) };
  });
  const visual = input.visual || {};
  if (visual.model && !CONTENT_MODELS.includes(visual.model)) fail();
  if (visual.animation && !CONTENT_ANIMATIONS.includes(visual.animation)) fail();
  if (visual.color && !/^#[0-9a-f]{6}$/i.test(visual.color)) fail();
  const usage = input.usage || "round";
  if (!["round", "run"].includes(usage)) fail();
  return { schemaVersion: 1, id, kind, name, img: image(input.img), description: text(input.description, 12000), class: cls,
    blackIceType: ["antipersonnel", "antiprogram", "other"].includes(input.blackIceType) ? input.blackIceType : "antipersonnel",
    stats, targets: [...new Set(targets)], damage: { standard: formula(input.damage?.standard), blackIce: formula(input.damage?.blackIce) },
    netActions: integer(input.netActions ?? 1, 10, 1), size: integer(input.size ?? (cls === "blackice" ? 2 : 1), 100),
    price: integer(input.price, 10000000), usage, effects,
    visual: { model: visual.model || (kind === "demon" ? "imp" : kind === "blackIce" ? "unknown" : "shield"), color: visual.color || "", animation: visual.animation || "auto" } };
}

export function documentContent(document) {
  const data = document?.flags?.[MODULE_ID]?.customContent;
  if (!data) return null;
  try { return normalizeContent(data); } catch { return null; }
}

export function contentDocumentData(input) {
  const def = normalizeContent(input);
  const description = `<p>${esc(def.description).replace(/\n/g, "<br>")}</p>`;
  const common = { name: def.name, img: def.img || "icons/svg/microchip.svg", ownership: { default: 0 }, flags: { [MODULE_ID]: { customContent: def } } };
  if (def.kind === "program") return { ...common, type: "program", system: {
    class: def.class, blackIceType: def.blackIceType, per: def.stats.per, spd: def.stats.spd, atk: def.stats.atk, def: def.stats.def,
    rez: { value: def.stats.rez, max: def.stats.rez }, damage: def.damage, size: def.size, price: { market: def.price }, isRezzed: false, description: { value: description }
  } };
  const stats = def.kind === "blackIce" ? { per: def.stats.per, spd: def.stats.spd, atk: def.stats.atk, def: def.stats.def }
    : { interface: def.stats.interface, actions: def.stats.actions, combatNumber: def.stats.combatNumber };
  return { ...common, type: def.kind, system: { ...(def.kind === "blackIce" ? { class: def.class, cost: def.price } : {}), notes: description,
    stats: { ...stats, rez: { value: def.stats.rez, max: def.stats.rez } } } };
}

export async function contentOperation(op, payload, userId, bridge) {
  if (!game.users.get(userId)?.isGM) return false;
  const store = foundry.utils.deepClone(game.settings.get(MODULE_ID, "customContent") || {});
  try {
    if (op === "content.save") {
      const def = normalizeContent(payload.definition);
      if (!Object.hasOwn(store, def.id) && Object.keys(store).length >= 500) fail();
      store[def.id] = def;
      await game.settings.set(MODULE_ID, "customContent", store);
      return { ok: true, definition: def };
    }
    const def = Object.hasOwn(store, payload.id) ? store[payload.id] : null;
    if (!def) return false;
    if (op === "content.delete") {
      delete store[payload.id];
      await game.settings.set(MODULE_ID, "customContent", store);
      return { ok: true };
    }
    if (op === "content.createDocument") {
      if (payload.confirmed !== true) return false;
      const document = await bridge.createContentDocument(def);
      return document ? { ok: true, documentUuid: document.uuid } : false;
    }
    return false;
  } catch (error) { return { error: error.message === "CRNS.Content.Invalid" ? error.message : "CRNS.Errors.SystemApi" }; }
}
