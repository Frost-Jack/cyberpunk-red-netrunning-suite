/* Index-only cache: never load entire Compendium documents during a render. */
import { PROGRAM_INFO, loc, blackIceTypeForName } from "./constants.js";
const icons = new Map();
let loading;
const normalized = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function keyFor(name) {
  const value = normalized(name);
  if (value.startsWith("speedygonzal")) return "speedy gonzalvez";
  for (const [key, info] of Object.entries(PROGRAM_INFO)) {
    if ([key, info.key, loc(`CRNS.Program.${info.key}.name`)].some(n => normalized(n) === value)) return key;
  }
  return blackIceTypeForName(name) || value;
}
export function programIcon(name, fallback = "systems/cyberpunk-red-core/icons/memory-card.svg") {
  return icons.get(keyFor(name)) || fallback;
}
export function loadProgramIcons() {
  if (loading) return loading;
  loading = (async () => {
    const packs = Array.from(game.packs || []).filter(pack =>
      (pack.documentName || pack.metadata?.type) === "Item"
      && /program|netrun|black.?ice/i.test(`${pack.collection} ${pack.metadata?.label}`)
      && (!pack.testUserPermission || pack.testUserPermission(game.user, "OBSERVER")));
    packs.sort((a, b) => Number(b.collection === "cyberpunk-red-core.core_programs") - Number(a.collection === "cyberpunk-red-core.core_programs"));
    for (const pack of packs) {
      try {
        const index = await pack.getIndex({ fields: ["name", "img", "type"] });
        for (const item of index) {
          if (!item.img || item.img === "icons/svg/item-bag.svg") continue;
          const key = keyFor(item.name);
          if (!icons.has(key)) icons.set(key, item.img);
        }
      } catch (error) { console.debug("Netrunning Suite | Cannot index program icons", pack.collection, error); }
    }
    return icons.size;
  })();
  return loading;
}
