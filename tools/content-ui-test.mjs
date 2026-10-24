/* Offline Chrome: real content editor class, template, listeners and CSS.
 * Application, dialogs and document mutations are fixture doubles. No Foundry world is opened. */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("../", import.meta.url), read = p => readFileSync(new URL(p, root), "utf8");
const require = createRequire(import.meta.url);
const dependencies = join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const foundryRoot = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { chromium } = require(join(dependencies, "playwright"));
const files = Object.fromEntries(["constants.js", "custom-content.js", "apps/content-editor.js"].map(p => [p, read(`scripts/${p}`)]));
const template = read("templates/content-editor.hbs"), css = read("styles/netrunning.css");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CRNS_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const output = mkdtempSync(join(tmpdir(), "crns-content-ui-"));
let passed = false;
try {
  const page = await browser.newPage(); const errors = [], findings = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<div id="fixture" class="window-app crns-window crns-content-window"><div class="window-content"></div></div>');
  await page.addStyleTag({ content: readFileSync(join(foundryRoot, "public/css/style.css"), "utf8") });
  await page.addStyleTag({ content: css + '\nhtml,body{margin:0;width:100%;height:100%;overflow:hidden}#fixture{position:relative!important;width:100%;height:100%;display:flex}.window-content{width:100%;height:100%}' });
  for (const path of ["jquery/dist/jquery.min.js", "handlebars/dist/handlebars.min.js"]) await page.addScriptTag({ content: readFileSync(join(foundryRoot, "node_modules", path), "utf8") });
  await page.evaluate(({ files, template, dictionary }) => {
    window.translations = dictionary; window.calls = []; window.warnings = []; window.exports = []; window.dialogs = []; window.store = {}; let nextId = 0;
    window.game = { user: { isGM: true }, items: [], actors: [], i18n: { localize: key => key.split('.').reduce((v,k) => v?.[k], translations) ?? key } };
    window.foundry = { utils: { randomID: () => 'content_' + String(++nextId).padStart(8,'0'), mergeObject: (a,b) => ({...a,...b}) } };
    window.ui = { notifications: { warn: msg => warnings.push(msg), info: () => {} } };
    window.Dialog = { confirm: async data => { dialogs.push(data); if(window.holdConfirm) return new Promise(resolve=>window.releaseConfirm=resolve); await new Promise(r => setTimeout(r, 40)); return window.confirmResult !== false; } };
    window.saveDataToFile = (data, type, filename) => exports.push({ data, type, filename });
    window.fromUuidSync = () => null;
    Handlebars.registerHelper('localize', key => game.i18n.localize(key));
    const renderTemplate = Handlebars.compile(template);
    window.Application = class {
      static get defaultOptions() { return {}; }
      activateListeners() {}
      render() { const host = document.querySelector('.window-content'); host.innerHTML = renderTemplate(this.getData()); this.element = $('#fixture'); this.activateListeners($(host)); return this; }
      async close() { document.querySelector('.window-content').replaceChildren(); return this; }
    };
    function load(name, deps = {}) {
      const source = files[name], names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1]);
      return new Function('deps', `const {${Object.keys(deps)}}=deps;${source.replace(/^import .*;\r?$/gm,'').replace(/\bexport\s+/g,'')};return {${names}}`)(deps);
    }
    const constants = load('constants.js'), content = load('custom-content.js', constants);
    const editor = load('apps/content-editor.js', { ...constants, ...content, getWorld: () => store,
      bridge: { contentFromDocument: (_,id) => content.normalizeContent({id,kind:'program',name:'Sample'}) },
      mutate: async (op,payload) => { calls.push({op,payload:structuredClone(payload)}); await new Promise(r => setTimeout(r, window.mutationDelay || 25));
        if(op==='content.save') { store[payload.definition.id] = structuredClone(payload.definition); return {ok:true,definition:payload.definition}; }
        if(op==='content.delete') { delete store[payload.id]; return {ok:true}; } return {ok:true,documentUuid:'Item.fixture'}; } });
    window.api = editor; window.instance = new editor.ContentEditor();
    window.render = (language, definition) => { translations = language; if(definition) instance.draft = content.normalizeContent(definition); instance.dirty = false; instance.render(true); };
    window.reset = () => { calls.length=0; dialogs.length=0; warnings.length=0; exports.length=0; window.confirmResult=true; };
    instance.render(true);
  }, { files, template, dictionary: JSON.parse(read('lang/en.json')) });
  const check = (condition, message) => { if (!condition) findings.push(message); };
  const initial = await page.evaluate(() => structuredClone(instance.draft));
  for (const language of ['en','ru']) for (const width of [480,780]) {
    await page.setViewportSize({ width, height: 760 });
    await page.evaluate(({ dictionary, initial }) => {
      store.long_name = { ...initial, id: 'long_name', name: 'ДлинноеНазваниеБезПробелов'.repeat(6).slice(0,120) };
      render(dictionary, initial);
    }, { dictionary: JSON.parse(read(`lang/${language}.json`)), initial });
    check(!(await page.locator('form').innerText()).includes('CRNS.Content.'), `${language}/${width}: untranslated editor label`);
    await page.locator('[name="name"]').fill('Своя программа ' + 'Ж'.repeat(95));
    await page.locator('[name="description"]').fill('Описание\n<script>attack()</script>');
    check(await page.locator('[name="description"]').evaluate(e=>document.activeElement===e), `${language}/${width}: text input loses focus`);
    await page.locator('[name="img"]').fill('my-art/Моя сеть/custom.webp');
    check(await page.locator('[name="img"]').evaluate(e=>document.activeElement===e), `${language}/${width}: image input loses focus`);
    await page.locator('[name="standard"]').fill('2d6+1');
    await page.locator('[name="model"]').selectOption('sword');
    await page.locator('[name="animation"]').selectOption('hellbolt');
    await page.locator('[name="color"]').fill('#123abc');
    await page.locator('[data-action="content-add-effect"]').click();
    await page.locator('[name="effectDescription0"]').fill('Своё описание эффекта');
    await page.locator('[data-action="content-save"]').click();
    await page.waitForFunction(() => !instance.busy && !instance.dirty);
    const saved = await page.evaluate(() => calls.filter(c=>c.op==='content.save').at(-1).payload.definition);
    assert.equal(saved.damage.standard,'2d6+1'); assert.equal(saved.visual.model,'sword'); assert.equal(saved.visual.animation,'hellbolt');
    assert.equal(saved.visual.color,'#123abc'); assert.equal(saved.effects[0].description,'Своё описание эффекта');
    assert.equal(saved.description,'Описание\n<script>attack()</script>');
    assert.equal(saved.img,'my-art/Моя сеть/custom.webp','arbitrary relative Foundry Data folder survives form save');
    const metrics = await page.evaluate(() => {
      const form=document.querySelector('form'), fields=document.querySelector('.crns-content-fields'), button=document.querySelector('[data-action="content-save"]');
      const style=getComputedStyle(button); return { overflow:form.scrollWidth>form.clientWidth+1 || fields.scrollWidth>fields.clientWidth+1 || document.body.scrollWidth>innerWidth,
        height:button.getBoundingClientRect().height, border:parseFloat(style.borderTopWidth), padding:parseFloat(style.paddingTop),
        footer:button.getBoundingClientRect().bottom<=innerHeight+1 };
    });
    check(!metrics.overflow,`${language}/${width}: horizontal overflow`);
    check(metrics.height>=26 && metrics.border>=1 && metrics.padding>=4,`${language}/${width}: native/shared reset erases content button hit area ${JSON.stringify(metrics)}`);
    check(metrics.footer,`${language}/${width}: footer outside window`);
    await page.screenshot({path:join(output,`${language}-${width}.png`)});
  }
  const checkedTargets = () => page.locator('[name="targets"]:checked').evaluateAll(nodes=>nodes.map(n=>n.value));
  await page.locator('[name="class"]').selectOption('antiprogramattacker');
  assert.deepEqual(await checkedTargets(),['program','blackIce','demon']);
  await page.locator('[name="class"]').selectOption('antipersonnelattacker');
  assert.deepEqual(await checkedTargets(),['runner']);
  await page.locator('[name="class"]').selectOption('blackice');
  await page.locator('[name="blackIceType"]').selectOption('antiprogram');
  assert.deepEqual(await checkedTargets(),['program','blackIce','demon']);
  await page.locator('[data-action="content-save"]').click(); await page.waitForFunction(()=>!instance.busy&&!instance.dirty);
  assert.deepEqual(await page.evaluate(()=>instance.draft.targets),['program','blackIce','demon']);
  await page.evaluate(()=>reset());
  await page.locator('[data-action="content-export"]').click();
  const exported=await page.evaluate(()=>exports[0]); assert.equal(exported.type,'application/json');
  await page.locator('[data-action="content-import"]').setInputFiles({name:'import.json',mimeType:'application/json',buffer:Buffer.from(exported.data)});
  await page.waitForFunction(id=>instance.draft.id!==id,JSON.parse(exported.data).id);
  const imported=await page.evaluate(()=>structuredClone(instance.draft));
  assert.equal(imported.visual.model,'sword'); assert.equal(imported.effects.length,1); assert.equal(imported.name,JSON.parse(exported.data).name);
  await page.evaluate(()=>{instance.dirty=false;reset()});
  await page.locator('[data-action="content-import"]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad}')});
  await page.waitForFunction(()=>warnings.length===1);
  assert.equal(await page.evaluate(()=>instance.draft.id),imported.id,'invalid import preserves draft');
  const locked = await page.evaluate(() => {
    reset(); window.mutationDelay = 100; document.querySelector('[data-action="content-save"]').click();
    document.querySelector('[data-action="content-new"]').click();
    return { busy: instance.busy, disabled: [...document.querySelectorAll('form input,form select,form textarea,form button')].every(e=>e.disabled), id:instance.draft.id };
  });
  assert.deepEqual(locked,{busy:true,disabled:true,id:imported.id},'saving locks all editor controls and keeps the current draft');
  await page.waitForFunction(()=>!instance.busy); await page.evaluate(()=>{window.mutationDelay=25});
  await page.evaluate(()=>{reset(); const b=document.querySelector('[data-action="content-create"]'); b.click(); setTimeout(()=>b.click(),35); setTimeout(()=>b.click(),45)});
  await page.waitForTimeout(250);
  const repeated=await page.evaluate(()=>({dialogs:dialogs.length,documents:calls.filter(c=>c.op==='content.createDocument').length}));
  check(repeated.dialogs===1 && repeated.documents===1,`repeated create opens ${repeated.dialogs} dialogs and creates ${repeated.documents} documents`);
  for(const kind of ['blackIce','demon']) {
    await page.locator('[name="kind"]').selectOption(kind); await page.waitForFunction(kind=>instance.draft.kind===kind,kind);
    await page.locator('[name="name"]').fill(kind==='demon'?'Свой демон':'Свой лёд'); await page.locator('[name="stat_rez"]').fill('42');
    await page.locator('[data-action="content-save"]').click(); await page.waitForFunction(()=>!instance.busy&&!instance.dirty);
    assert.equal(await page.evaluate(()=>instance.draft.stats.rez),42);
  }
  const replacementRace=await page.evaluate(async()=>{
    reset();instance.dirty=true;window.holdConfirm=true;window.mutationDelay=100;
    const id=instance.draft.id;document.querySelector('[data-action="content-new"]').click();
    document.querySelector('[data-action="content-save"]').click();
    window.holdConfirm=false;window.releaseConfirm(true);await Promise.resolve();await Promise.resolve();
    const preserved=instance.draft.id===id;await new Promise(resolve=>setTimeout(resolve,130));window.mutationDelay=25;
    return preserved;
  });
  check(replacementRace,'pending discard confirmation must not replace draft while save is busy');
  assert.equal(await page.evaluate(async()=>{instance.dirty=true;window.confirmResult=false;await instance.close();return !!document.querySelector('form')}),true,'canceling the unsaved prompt keeps editor open');
  assert.deepEqual(errors,[]); assert.deepEqual(findings,[],findings.join('\n'));
  console.log(JSON.stringify({renderer:'offline Chrome / actual ContentEditor + HBS + CSS',languages:['en','ru'],widths:[480,780],capture:true,importExport:true,repeatedCreate:repeated,output,errors},null,2));
  passed=true;
} catch(error) { console.error(error.stack || String(error)); throw error; }
finally { setTimeout(()=>process.exit(passed?0:1),3000).unref(); await browser.close(); }
