import { root, part, bakeModel, disposePrimitiveCache } from "./model-kit.js";
import { hunterModel, HUNTER_KEYS } from "./ice-hunters.js";
import { stalkerModel, STALKER_KEYS } from "./ice-stalkers.js";
import { avatarModel, programModel, AVATAR_KEYS, PROGRAM_KEYS } from "./avatars-programs.js";
import { BLACK_ICE, PROGRAM_INFO, loc, blackIceTypeForName } from "../constants.js";

export const MODEL_KEYS = [...HUNTER_KEYS, ...STALKER_KEYS, ...AVATAR_KEYS, ...PROGRAM_KEYS];
export const ATTACK_ANIMATIONS = ["auto", "none", "sword", "banhammer", "deckkrash", "hellbolt", "nervescrub", "poisonflatline", "superglue", "vrizzbolt"];
const assets = new Map();
let consumers = 0;
const normalize = value => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function entityVisual(entity = {}) {
  const visual = entity.visual || {};
  return { model: visual.model === "unknown" || MODEL_KEYS.includes(visual.model) ? visual.model : "",
    color: /^#[\da-f]{6}$/i.test(String(visual.color || "")) ? visual.color : "",
    animation: ATTACK_ANIMATIONS.includes(visual.animation) ? visual.animation : "auto" };
}
export function entityModelKey(entity, kind = "ice") {
  const visual = entityVisual(entity);
  if (visual.model) return visual.model;
  if (kind === "runner" || entity.ref?.startsWith("runner:")) return "runner";
  const name = normalize(entity.name), direct = normalize(entity.modelKey || entity.iceType || entity.type);
  if (MODEL_KEYS.includes(direct)) return direct;
  const ice = blackIceTypeForName(entity.name);
  if (ice && BLACK_ICE[ice]) return ice;
  for (const key of ["imp", "efreet", "balron"]) {
    if ([key, loc(`CRNS.Demon.${key}.name`)].some(value => normalize(value) === name)) return key;
  }
  if (["rocklobster", "роклобстер"].includes(name)) return "rocklobster";
  for (const [key, info] of Object.entries(PROGRAM_INFO)) {
    if ([key, info.key, loc(`CRNS.Program.${info.key}.name`)].some(value => normalize(value) === name)) return normalize(key);
  }
  if (name.startsWith("speedygonzal")) return "speedygonzalvez";
  return kind === "demon" ? "balron" : kind === "mini" ? "shield" : "unknown";
}
export function retainModelAssets() { consumers++; }
export function releaseModelAssets() { if (consumers > 0 && --consumers === 0) disposeModelAssets(); }
export function modelAsset(key) {
  if (assets.has(key)) return assets.get(key);
  let model = hunterModel(key) || stalkerModel(key) || avatarModel(key) || programModel(key);
  if (!model) { model = root("unknown"); part(model, "octa", [0, 1, 0], [1.5, 2, 1.5]); part(model, "torus", [0, 1, 0], [2, 2, 2]); }
  const asset = bakeModel(model); assets.set(key, asset); return asset;
}
export function disposeModelAssets() {
  for (const asset of assets.values()) { asset.geometry.dispose(); asset.edges.dispose(); }
  assets.clear(); disposePrimitiveCache();
}
