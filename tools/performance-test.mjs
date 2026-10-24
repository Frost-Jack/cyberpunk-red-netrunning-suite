/* Repeatable CPU benchmarks of the actual view-model, not a live Foundry FPS claim. */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const actors = new Map();
const users = new Map([["gm", { id: "gm", isGM: true, active: true }]]);
users.find = fn => [...users.values()].find(fn);
const game = { user: users.get("gm"), users, actors,
  i18n: { localize: key => key, format: key => key } };
const context = vm.createContext({ game, console, fromUuidSync: id => actors.get(id) });
function load(path, imports = {}) {
  const source = readFileSync(new URL(path, root), "utf8");
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]);
  const body = source.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "");
  return vm.runInContext(`(imports=>{const {${Object.keys(imports)}}=imports;${body};return {${names}};})`, context, { filename: path })(imports);
}
const constants = load("scripts/constants.js");
const topology = load("scripts/topology.js");
const mechanics = load("scripts/data.js", { ...constants, ...topology });
const descriptions = load("scripts/descriptions.js", constants);
let world;
const canvas = load("scripts/apps/arch-canvas.js", { ...constants, ...topology, ...mechanics, ...descriptions,
  getWorld: key => structuredClone(world[key]), mutate: () => {}, isPlayerRunner: p => !!p.userId,
  getDeck: actor => actor?.deck, installedPrograms: deck => deck?.programs || [],
  mount3D: () => {}, dispose3D: () => {} });
const app = { state: {}, myParticipant: () => null };
console.log("CPU model benchmark; includes world-setting cloning; milliseconds per getData.");
for (const count of [10, 50, 100]) {
  actors.clear();
  const floors = Array.from({ length: count }, (_, i) => ({ id: `f${i}`, parentId: i ? `f${i - 1}` : "",
    kind: "custom", ice: Array.from({ length: 3 }, (_, j) => {
      const id = `a${i}-${j}`;
      actors.set(id, { id, name: "Hellhound", img: "token.png", system: { stats: { per: 6, spd: 6, atk: 6, def: 2, rez: { value: 20, max: 20 } } } });
      return { id, actorId: id, type: "hellhound" };
    }) }));
  world = { netArchs: { arch: { id: "arch", floors } }, session: { activeTab: "arch", participants: {}, targets: {} } };
  for (let i = 0; i < 10; i++) {
    const id = `runner${i}`;
    actors.set(id, { id, name: id, deck: { programs: Array.from({ length: 7 }, (_, j) => ({ id: `p${j}`, name: "Armor", system: { class: "defender", isRezzed: true, rez: { value: 7, max: 7 } } })) } });
    world.session.participants[id] = { kind: "runner", actorUuid: id, archId: "arch", floorIndex: i % count };
  }
  for (let n = 0; n < 10; n++) canvas.getData(app);
  const samples = [];
  for (let n = 0; n < 100; n++) {
    const start = performance.now();
    const result = canvas.getData(app);
    samples.push(performance.now() - start);
    assert.equal(result.canvas.floors.length, count);
  }
  samples.sort((a, b) => a - b);
  const median = samples[50], p95 = samples[95];
  console.log(JSON.stringify({ floors: count, ice: count * 3, runners: 10, median: +median.toFixed(2), p95: +p95.toFixed(2) }));
  assert.ok(p95 < 250, `Unexpected CPU regression at ${count} floors: ${p95}ms`);
}
