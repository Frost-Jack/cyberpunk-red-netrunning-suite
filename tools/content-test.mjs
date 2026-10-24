/* Definition validation and store/document boundaries. No running Foundry world. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as constants from "../scripts/constants.js";
import * as topology from "../scripts/topology.js";
import { normalizeContent, contentDocumentData, documentContent, contentOperation } from "../scripts/custom-content.js";
const MODULE_ID = "cyberpunk-red-netrunning-suite";
const base = { id: "customSword", kind: "program", name: "Резец", class: "antiprogramattacker", stats: { atk: 3, rez: 0 },
  damage: { standard: "2d6+1", blackIce: "3d6" }, targets: ["program", "blackIce"], netActions: 2, usage: "run",
  visual: { model: "sword", color: "#aabbcc", animation: "sword" }, effects: [{ type: "destroy", description: "При 0 REZ" }] };
const def = normalizeContent(base);
assert.equal(normalizeContent(JSON.parse(JSON.stringify(def))).id, def.id);
for (const override of [{ schemaVersion: 2 }, { id: "__proto__" }, { kind: "macro" }, { stats: { rez: -1 } },
  { netActions: 0 }, { size: 1.1 }, { targets: ["everything"] }, { effects: [{ type: "eval", script: "alert(1)" }] },
  { damage: { standard: "1d6;alert(1)" } }, { damage: { standard: "@actor.hp" } }, { img: "javascript:alert(1)" },
  { img: "../outside.png" }, { img: "//untrusted.net/img.png" }, { visual: { model: "bogus" } }, { visual: { color: "red;position:absolute" } }]) {
  assert.throws(() => normalizeContent({ ...base, ...override }));
}
assert.equal(normalizeContent({ ...base, img: "my-art/Клинок.webp" }).img, "my-art/Клинок.webp");
assert.equal(normalizeContent({ ...base, img: "Miri.webp" }).img, "Miri.webp");
const safe = contentDocumentData({ ...base, description: '<img src=x onerror="alert(1)">', ownership: { default: 3 }, _id: "old", macro: "run()" });
assert.equal(safe.type, "program"); assert.equal(safe.system.size, 1); assert.equal(safe.system.atk, 3);
assert.equal(safe.system.price.market, 0); assert.equal(safe.ownership.default, 0);
assert.ok(safe.system.description.value.includes("&lt;img")); assert.ok(!safe.system.description.value.includes("<img"));
assert.equal(safe._id, undefined); assert.equal(safe.macro, undefined);
assert.equal(safe.flags[MODULE_ID].managedEntity, undefined, "permanent documents never get a cleanup marker");
assert.equal(documentContent({ name: "Переименовано", flags: safe.flags }).id, def.id);
assert.deepEqual(documentContent({ name: "Переименовано", flags: safe.flags }).effects, def.effects);
assert.equal(documentContent({ flags: { [MODULE_ID]: { customContent: { ...base, effects: [{ type: "code" }] } } } }), null);
for (const kind of ["blackIce", "demon"]) {
  const data = contentDocumentData({ ...base, kind, class: "antipersonnel", targets: ["runner"], stats: { rez: 20, actions: 4, interface: 6, combatNumber: 12 } });
  assert.equal(data.type, kind); assert.equal(data.system.stats.rez.value, 20);
  assert.equal(data.system.description, undefined); assert.equal(data.system.notes.startsWith("<p>"), true);
  if (kind === "demon") assert.equal(data.system.stats.actions, 4);
}
let store = {}, creates = 0;
globalThis.foundry = { utils: { deepClone: structuredClone } };
globalThis.game = { users: new Map([["gm", { isGM: true }], ["player", { isGM: false }]]), settings: {
  get: () => store, set: async (_, key, value) => { assert.equal(key, "customContent"); store = value; }
} };
const bridge = { createContentDocument: async definition => { creates++; return { uuid: `Item.fresh${creates}`, name: definition.name }; } };
assert.equal(await contentOperation("content.save", { definition: base }, "player", bridge), false);
assert.equal((await contentOperation("content.save", { definition: base }, "gm", bridge)).ok, true);
assert.equal(creates, 0, "saving a definition creates no documents");
assert.equal(await contentOperation("content.createDocument", { id: base.id }, "gm", bridge), false);
assert.equal((await contentOperation("content.createDocument", { id: base.id, confirmed: true }, "gm", bridge)).documentUuid, "Item.fresh1");
const copy = { ...base, id: "secondCopy", name: "Копия" };
await contentOperation("content.save", { definition: copy }, "gm", bridge);
await contentOperation("content.delete", { id: base.id }, "gm", bridge);
assert.equal(creates, 1, "definition edits/deletion never touch documents");
assert.ok(store.secondCopy); assert.equal(store.customSword, undefined);
assert.equal(documentContent({ flags: safe.flags }).id, base.id, "snapshot survives definition deletion");
// Actual bridge/data/export bodies, with only Foundry document I/O replaced.
let sequence = 0;
const actors = new Map(), folders = [], world = new Map();
game.user = { id: "gm", isGM: true }; game.actors = actors; game.folders = folders;
game.i18n = { localize: key => key, format: key => key };
game.users.get("gm").id = "gm";
game.settings = { get: (_, key) => world.get(key), set: async (_, key, value) => { world.set(key, structuredClone(value)); return value; } };
foundry.utils.randomID = () => `native${++sequence}`;
const context = vm.createContext({ game, foundry, console, ...constants,
  Actor: { create: async data => {
    const id = `actor${++sequence}`, source = structuredClone(data);
    const actor = { ...source, id, uuid: `Actor.${id}`, toObject: () => structuredClone(source),
      update: async patch => { for (const [key, value] of Object.entries(patch)) {
        const parts = key.split("."); let at = actor; while (parts.length > 1) at = at[parts.shift()] ||= {}; at[parts[0]] = value;
      } } };
    actors.set(id, actor); return actor;
  }, deleteDocuments: async ids => { for (const id of ids) actors.delete(id); } },
  Item: { create: async data => ({ ...structuredClone(data), id: `item${++sequence}`, uuid: `Item.${sequence}` }) },
  Folder: { create: async data => { const folder = { ...data, id: `folder${++sequence}`, folder: data.folder ? { id: data.folder } : null }; folders.push(folder); return folder; } },
});
function load(path, imports, privates = []) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]);
  const body = source.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "");
  return vm.runInContext(`(imports=>{const {${Object.keys(imports)}}=imports;${body};return {${[...names, ...privates]}};})`, context)(imports);
}
const { netActionsMax, ...bridgeConstants } = constants;
const native = load("scripts/cpr-bridge.js", { ...bridgeConstants, _netActionsMax: netActionsMax, normalizeContent, contentDocumentData, documentContent });
for (const kind of ["program", "blackIce", "demon"]) {
  const definition = normalizeContent({ ...base, kind, class: kind === "program" ? "antiprogramattacker" : "antipersonnel", targets: kind === "program" ? ["blackIce"] : ["runner"] });
  const document = await native.createContentDocument(definition);
  assert.equal(document.type, kind); assert.equal(document.flags[MODULE_ID].managedEntity, undefined);
  assert.equal(native.programDefinition(document).id, definition.id);
}
const customIce = normalizeContent({ id: "archCustom", kind: "blackIce", name: "Лед", class: "antiprogram", stats: { atk: 9, rez: 30 }, damage: { standard: "4d6" }, targets: ["program", "blackIce"] });
const actorId = await native.createContentActor(customIce, "Test architecture");
const actorDoc = actors.get(actorId);
assert.equal(actorDoc.flags[MODULE_ID].managedEntity, true);
actorDoc.name = "Новое имя"; actorDoc.system.stats.atk = 12;
const sample = native.contentFromDocument(actorDoc, "newSample");
assert.equal(sample.name, "Новое имя"); assert.equal(sample.stats.atk, 12); assert.equal(sample.damage.standard, "4d6");
const copiedId = await native.duplicateEntityActor(actorId, "Copied architecture");
assert.equal(native.programDefinition(actors.get(copiedId)).id, customIce.id);
const snapshot = native.snapshotEntityActor(actorId);
assert.equal(snapshot.flags[MODULE_ID].customContent.id, customIce.id);
const data = load("scripts/data.js", { ...constants, ...topology, bridge: native, contentOperation });
for (const [key, value] of Object.entries(data.WORLD_OBJECTS)) world.set(key, structuredClone(value));
const tree = load("scripts/apps/tree.js", { ...constants, ...data, snapshotEntityActor: native.snapshotEntityActor }, ["enrichArchForExport"]);
const imported = await data.applyOp("arch.import", { arch: { name: "Custom archive", floors: [{ id: "entry", kind: "custom", ice: [{ id: "old", type: `custom_${customIce.id}`, content: customIce }] }] } }, "gm");
assert.ok(imported.archId);
const storedArch = world.get("netArchs")[imported.archId];
assert.equal(native.programDefinition(actors.get(storedArch.floors[0].ice[0].actorId)).id, customIce.id);
const archive = tree.enrichArchForExport(storedArch);
assert.equal(archive.floors[0].ice[0].actorId, undefined);
assert.equal(archive.floors[0].ice[0].actorData.flags[MODULE_ID].customContent.id, customIce.id);
assert.equal(Object.keys(world.get("customContent")).length, 0, "archive works without registry entry");
const reimported = await data.applyOp("arch.import", { arch: archive }, "gm");
assert.ok(reimported.archId);
const duplicated = await data.applyOp("arch.duplicate", { archId: imported.archId }, "gm");
assert.ok(duplicated.archId);
assert.equal(world.get("netArchs")[duplicated.archId].floors[0].ice[0].content.id, customIce.id);
console.log("Content: validation, safe imports, native document creation, renamed samples, snapshot/duplicate/export/reimport without registry, GM permissions and explicit creation pass.");
