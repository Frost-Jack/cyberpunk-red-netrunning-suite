import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MODEL_KEYS, modelAsset, disposeModelAssets, entityModelKey, entityVisual, retainModelAssets, releaseModelAssets } from "../scripts/3d/models.js";
import { layoutArchitecture } from "../scripts/3d/layout.js";
globalThis.game = { i18n: { localize: key => key } };
const hashes = new Set();
assert.equal(MODEL_KEYS.length, 32);
for (const key of MODEL_KEYS) {
  const asset = modelAsset(key), p = asset.geometry.getAttribute("position"), color = asset.geometry.getAttribute("color");
  assert.ok(p.count > 20 && p.count < 20000, key);
  assert.equal(p.count, color.count, key);
  assert.ok([...p.array].every(Number.isFinite), key);
  assert.ok(Math.abs(asset.bounds.min.y) < 0.00001, `${key} stands on the floor`);
  assert.ok(asset.bounds.max.y < 2.801, key);
  assert.ok(asset.bounds.max.x - asset.bounds.min.x < 2.601, key);
  hashes.add(createHash("sha256").update(Buffer.from(p.array.buffer)).update(Buffer.from(color.array.buffer)).digest("hex"));
  assert.equal(modelAsset(key), asset, "model geometry is cached");
}
assert.equal(hashes.size, 32, "every model has a distinct geometric/color signature");
assert.equal(entityModelKey({ name: "Hellhound" }), "hellhound");
assert.equal(entityModelKey({ name: "Speedy Gonzales" }, "mini"), "speedygonzalvez");
for (const kind of ["ice", "mini", "demon"]) for (const model of MODEL_KEYS) {
  assert.equal(entityModelKey({ name: "Моя сущность", visual: { model } }, kind), model, "custom visual does not depend on an English name or entity kind");
}
assert.deepEqual(entityVisual({ visual: { model: "missing", color: "url(secret)", animation: "script" } }), { model: "", color: "", animation: "auto" });
assert.deepEqual(entityVisual({ visual: { model: "asp", color: "#Aabb09", animation: "none" } }), { model: "asp", color: "#Aabb09", animation: "none" });
assert.equal(entityModelKey({ name: "Hellhound", visual: { model: "unknown" } }), "unknown", "explicit fallback never reinterprets a custom name");
const crowded = { index: 0, floorId: "entry", row: 1, column: 1, participants: [{ ref: "runner:p", progMinis: Array.from({ length: 15 }, (_, i) => ({ ref: `prog:p:${i}` })) }], entities: Array.from({ length: 12 }, (_, i) => ({ ref: `ice:a:f:${i}` })), demonEntities: [{ ref: "demon:a:f:d" }] };
const fog = { index: 1, floorId: "fog", row: 2, column: 1, isFog: true };
for (const key of ["entities", "participants", "demonEntities", "label", "dv"]) Object.defineProperty(fog, key, { get() { throw Error(`Fog leak: ${key}`); } });
const layout = layoutArchitecture([crowded, fog]);
assert.ok(layout[0].z + layout[0].depth / 2 < layout[1].z - layout[1].depth / 2);
for (const f of layout) for (const r of f.entities) assert.ok(r.y >= f.y);
const before = layoutArchitecture([crowded])[0].entities.map(({ x, y, z }) => ({ x, y, z }));
crowded.entities[0].selected = true;
const positions = layoutArchitecture([crowded])[0].entities.map(({ x, y, z }) => ({ x, y, z }));
assert.deepEqual(positions, before, "selection never changes world positions");
const branches = layoutArchitecture([1, 2].map(column => ({ floorId: `branch${column}`, row: 1, column,
  demonEntities: Array.from({ length: 8 }, (_, i) => ({ ref: `demon:${column}:${i}` })) })));
assert.ok(Math.min(...branches[1].entities.map(r => r.x - 2)) > branches[0].x + branches[0].width / 2, "all demon pedestals keep clear of the adjacent branch");
const cached = modelAsset("asp"); let disposals = 0;
cached.geometry.addEventListener("dispose", () => disposals++);
retainModelAssets(); retainModelAssets(); releaseModelAssets();
assert.equal(disposals, 0, "closing one scene preserves model assets used by another");
assert.equal(modelAsset("asp"), cached);
releaseModelAssets(); assert.equal(disposals, 1, "last scene releases shared model assets");
disposeModelAssets();
console.log("32 distinct book-inspired model meshes: finite, normalized, cached; opaque-floor spacing and fog boundaries pass.");
