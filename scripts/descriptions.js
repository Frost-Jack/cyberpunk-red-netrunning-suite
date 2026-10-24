import { BLACK_ICE, PROGRAM_INFO, blackIceTypeForName, loc } from "./constants.js";

export function programEffect(name) {
  const normalized = String(name || "").trim().toLowerCase();
  for (const [key, info] of Object.entries(PROGRAM_INFO)) {
    if (key === normalized || loc(`CRNS.Program.${info.key}.name`).toLowerCase() === normalized) {
      return loc(`CRNS.Program.${info.key}.effect`);
    }
  }
  const type = blackIceTypeForName(name);
  return type ? loc(`${BLACK_ICE[type].effectKey}.effect`) : "";
}

export function programHint(program) {
  const sys = program?.system || program || {};
  const custom = program?.flags?.["cyberpunk-red-netrunning-suite"]?.customContent;
  const effect = (!custom && programEffect(program?.name)) || String(sys.description?.value || sys.description || "").replace(/<[^>]*>/g, " ").trim();
  const rez = sys.rez || {};
  return [program?.name, `ATK ${sys.atk ?? 0} / DEF ${sys.def ?? 0} / REZ ${rez.value ?? 0}/${rez.max ?? 0}`, effect].filter(Boolean).join("\n");
}

export function iceHint(type, name, stats = {}) {
  return [name, `PER ${stats.per ?? 0} / SPD ${stats.spd ?? 0} / ATK ${stats.atk ?? 0} / DEF ${stats.def ?? 0}`,
    BLACK_ICE[type] ? loc(`${BLACK_ICE[type].effectKey}.effect`) : ""].filter(Boolean).join("\n");
}
