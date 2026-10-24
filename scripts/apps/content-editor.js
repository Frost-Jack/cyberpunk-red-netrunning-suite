import { MODULE_ID, TPL, loc } from "../constants.js";
import { getWorld, mutate } from "../data.js";
import { CONTENT_CLASSES, CONTENT_MODELS, CONTENT_ANIMATIONS, CONTENT_EFFECTS, normalizeContent } from "../custom-content.js";
import * as bridge from "../cpr-bridge.js";

const options = (values, value, prefix = "") => values.map(key => ({ key, name: prefix ? loc(`${prefix}.${key}`) : key, selected: key === value }));
const freshId = () => foundry.utils.randomID(16);
export function blankContent(kind = "program") {
  return normalizeContent({ id: freshId(), kind, name: loc("CRNS.Content.Untitled"), stats: { rez: 7, actions: 2 },
    class: kind === "program" ? "defender" : "antipersonnel" });
}

export class ContentEditor extends Application {
  constructor(options = {}) { super(options); this.draft = blankContent(); this.busy = false; this.dirty = false; }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "crns-content-editor", classes: ["crns-window", "crns-content-window"],
      template: TPL("content-editor"), title: loc("CRNS.Content.Title"), width: 780, height: 720, resizable: true,
      scrollY: [".crns-content-fields", ".crns-content-library"] });
  }
  getData() {
    if (!game.user.isGM) return {};
    const def = this.draft;
    const samples = [...Array.from(game.items || []).filter(d => d.type === "program"), ...Array.from(game.actors || []).filter(d => ["blackIce", "demon"].includes(d.type))];
    return { def, dirty: this.dirty, busy: this.busy || this._creating, isProgram: def.kind === "program", isDemon: def.kind === "demon",
      kinds: options(["program", "blackIce", "demon"], def.kind, "CRNS.Content.Kinds"),
      classes: options(def.kind === "program" ? CONTENT_CLASSES : ["antipersonnel", "antiprogram", "other"], def.class),
      iceClasses: options(["antipersonnel", "antiprogram", "other"], def.blackIceType),
      stats: (def.kind === "demon" ? ["rez", "interface", "actions", "combatNumber"] : ["per", "spd", "atk", "def", "rez"]).map(key => ({ key, value: def.stats[key] })),
      targets: ["runner", "program", "blackIce", "demon"].map(key => ({ key, name: loc(`CRNS.Content.Targets.${key}`), checked: def.targets.includes(key) })),
      usage: options(["round", "run"], def.usage, "CRNS.Content.Usage"),
      models: options(CONTENT_MODELS, def.visual.model), animations: options(CONTENT_ANIMATIONS, def.visual.animation),
      effects: def.effects.map((effect, index) => ({ ...effect, index, choices: options(CONTENT_EFFECTS, effect.type, "CRNS.Content.Effects") })),
      definitions: Object.values(getWorld("customContent") || {}).map(d => ({ id: d.id, name: d.name, kind: loc(`CRNS.Content.Kinds.${d.kind}`) })),
      samples: samples.map(d => ({ uuid: d.uuid, name: `${d.name} (${d.type})` })) };
  }
  capture(form) {
    const fields = new FormData(form);
    const previous = this.draft;
    const raw = { ...previous, name: fields.get("name"), img: fields.get("img"), description: fields.get("description"),
      class: fields.get("class") || previous.class, blackIceType: fields.get("blackIceType") || previous.blackIceType,
      targets: fields.getAll("targets"), stats: { ...previous.stats },
      damage: { standard: fields.get("standard") || "", blackIce: fields.get("blackIce") || "" },
      size: fields.get("size") ?? previous.size, price: fields.get("price"), netActions: fields.get("netActions"), usage: fields.get("usage"),
      visual: { model: fields.get("model"), color: fields.get("color"), animation: fields.get("animation") },
      effects: previous.effects.map((effect, i) => ({ type: fields.get(`effectType${i}`), description: fields.get(`effectDescription${i}`) })) };
    for (const key of Object.keys(raw.stats)) if (fields.has(`stat_${key}`)) raw.stats[key] = fields.get(`stat_${key}`);
    this.draft = normalizeContent(raw);
    return this.draft;
  }
  async mayReplace() {
    if (this.busy || this._creating) return false;
    const confirmed = !this.dirty || await Dialog.confirm({ title: loc("CRNS.Content.Unsaved"), content: `<p>${loc("CRNS.Content.Discard")}</p>`, defaultYes: false });
    return confirmed && !this.busy && !this._creating;
  }
  lockFields(form) { for (const field of form?.querySelectorAll("input, select, textarea, button") || []) field.disabled = true; }
  activateListeners(html) {
    super.activateListeners(html);
    if (!game.user.isGM) return;
    const form = html.find("form")[0] || html.filter("form")[0];
    if (this.busy || this._creating) this.lockFields(form);
    form?.addEventListener("submit", ev => { ev.preventDefault(); if (!this._creating) this.save(form); });
    form?.addEventListener("input", () => { this.dirty = true; });
    for (const select of form?.querySelectorAll('[name="class"], [name="blackIceType"]') || []) select.addEventListener("change", () => {
      const cls = form.querySelector('[name="class"]')?.value || "";
      const antiProgram = cls.includes("antiprogram") || (cls === "blackice" && form.querySelector('[name="blackIceType"]')?.value === "antiprogram");
      for (const check of form.querySelectorAll('[name="targets"]')) check.checked = antiProgram ? check.value !== "runner" : check.value === "runner";
    });
    html.find('[name="kind"]').on("change", async ev => {
      if (await this.mayReplace()) { this.draft = blankContent(ev.currentTarget.value); this.dirty = false; }
      this.render(false);
    });
    html.find('[data-action="content-new"]').on("click", async () => { if (await this.mayReplace()) { this.draft = blankContent(); this.dirty = false; this.render(false); } });
    html.find('[data-action="content-load"]').on("click", async ev => {
      const definition = getWorld("customContent")?.[ev.currentTarget.dataset.id];
      if (definition && await this.mayReplace()) { this.draft = normalizeContent(definition); this.dirty = false; this.render(false); }
    });
    html.find('[data-action="content-copy"]').on("click", () => this.withForm(form, () => { this.draft.id = freshId(); this.dirty = true; this.render(false); }));
    html.find('[data-action="content-sample"]').on("click", async () => {
      const document = fromUuidSync(html.find('[name="sample"]').val());
      if (document && await this.mayReplace()) {
        try { this.draft = bridge.contentFromDocument(document, freshId()); this.dirty = true; this.render(false); }
        catch { ui.notifications.warn(loc("CRNS.Content.Invalid")); }
      }
    });
    html.find('[data-action="content-save"]').on("click", () => { if (!this._creating) this.save(form); });
    html.find('[data-action="content-create"]').on("click", async () => {
      if (this.busy || this._creating) return;
      this._creating = true;
      try {
        if (!await this.save(form)) return;
        const id = this.draft.id;
        if (!await Dialog.confirm({ title: loc("CRNS.Content.Create"), content: `<p>${loc("CRNS.Content.CreateHint")}</p>`, defaultYes: false })) return;
        this.busy = true;
        const result = await mutate("content.createDocument", { id, confirmed: true });
        if (result?.ok) { ui.notifications.info(loc("CRNS.Content.Created")); fromUuidSync(result.documentUuid)?.sheet?.render(true); }
        else ui.notifications.warn(loc(result?.error || "CRNS.Errors.SystemApi"));
      } finally { this.busy = false; this._creating = false; this.render(false); }
    });
    html.find('[data-action="content-delete"]').on("click", async () => {
      if (this.busy || this._creating) return;
      const id = this.draft.id;
      if (!await Dialog.confirm({ title: loc("CRNS.Content.Delete"), content: `<p>${loc("CRNS.Content.DeleteHint")}</p>`, defaultYes: false })) return;
      if (this.busy || this._creating || id !== this.draft.id) return;
      this.busy = true; this.lockFields(form);
      try {
        const result = await mutate("content.delete", { id });
        if (result?.ok) { this.draft = blankContent(); this.dirty = false; }
      } finally { this.busy = false; this.render(false); }
    });
    html.find('[data-action="content-add-effect"]').on("click", () => this.withForm(form, () => { if (this.draft.effects.length < 12) this.draft.effects.push({ type: "manual", description: "" }); this.dirty = true; this.render(false); }));
    html.find('[data-action="content-remove-effect"]').on("click", ev => this.withForm(form, () => { this.draft.effects.splice(Number(ev.currentTarget.dataset.index), 1); this.dirty = true; this.render(false); }));
    html.find('[data-action="content-export"]').on("click", () => this.withForm(form, () => saveDataToFile(JSON.stringify(this.draft, null, 2), "application/json", `net-content-${this.draft.id}.json`)));
    html.find('[data-action="content-import"]').on("change", async ev => {
      const file = ev.currentTarget.files?.[0];
      if (!file || !await this.mayReplace()) return;
      try {
        if (file.size > 100000) throw new Error();
        const imported = normalizeContent(JSON.parse(await file.text()));
        if (this.busy || this._creating) return;
        // An import is a fresh draft, even if the archive's ID already exists.
        this.draft = { ...imported, id: freshId() }; this.dirty = true; this.render(false);
      } catch { ui.notifications.warn(loc("CRNS.Content.Invalid")); }
    });
  }
  withForm(form, callback) {
    if (this.busy || this._creating) return false;
    try { this.capture(form); return callback(); } catch { ui.notifications.warn(loc("CRNS.Content.Invalid")); return false; }
  }
  async save(form) {
    if (this.busy) return false;
    let definition;
    try { definition = this.capture(form); } catch { ui.notifications.warn(loc("CRNS.Content.Invalid")); return false; }
    this.busy = true;
    this.lockFields(form);
    try {
      const result = await mutate("content.save", { definition });
      if (!result?.ok) { ui.notifications.warn(loc(result?.error || "CRNS.Errors.SystemApi")); return false; }
      this.draft = normalizeContent(result.definition); this.dirty = false; return true;
    } finally { this.busy = false; if (!this._creating) this.render(false); }
  }
  async close(options) { if (!await this.mayReplace()) return this; return super.close(options); }
}

let editor;
export function getData() { return { contentAvailable: !!game.user.isGM }; }
export function activateListeners(app, html) {
  html.find('[data-action="content-open"]').on("click", () => {
    if (!game.user.isGM) return;
    editor ||= new ContentEditor();
    if (editor.rendered) editor.bringToTop?.(); else editor.render(true);
  });
}
