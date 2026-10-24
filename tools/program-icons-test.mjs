import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
let calls = 0;
const pack = { collection: "cyberpunk-red-core.core_programs", documentName: "Item",
  testUserPermission: () => true, getIndex: async () => {
    calls++; return [{ name: "Sword", img: "compendium/sword.webp" }, { name: "Speedy Gonzales", img: "compendium/speedy.webp" }];
  }, getDocuments() { throw Error("Full documents must not load"); } };
const blocked = { collection: "private.programs", documentName: "Item", testUserPermission: () => false, getIndex() { throw Error("Private pack read"); } };
const context = vm.createContext({ game: { packs: [pack, blocked], user: {} }, console });
const root = new URL("../", import.meta.url);
function load(file, deps = {}) {
  const s = readFileSync(new URL(file, root), "utf8"), names = [...s.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]);
  return vm.runInContext(`(deps=>{const {${Object.keys(deps)}}=deps;${s.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "")};return {${names}};})`, context)(deps);
}
const icons = load("scripts/program-icons.js", { PROGRAM_INFO: { sword: { key: "Sword" }, "speedy gonzalvez": { key: "SpeedyGonzalvez" } }, loc: k => k, blackIceTypeForName: () => "" });
await Promise.all([icons.loadProgramIcons(), icons.loadProgramIcons()]);
assert.equal(calls, 1);
assert.equal(icons.programIcon("Sword"), "compendium/sword.webp");
assert.equal(icons.programIcon("Speedy Gonzalvez"), "compendium/speedy.webp");
assert.equal(icons.programIcon("Custom program", "fallback.png"), "fallback.png");
console.log("Program icons: index-only, cached, permission-filtered and alias matched.");
