/* Actual offline WebGL renderer, shaders, meshes and public callbacks in Chrome.
 * No Foundry session is logged into or modified. node tools/webgl-test.mjs */
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/trokh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let passed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const html = `<!doctype html><html><head><link rel="stylesheet" href="/modules/cyberpunk-red-netrunning-suite/styles/netrunning.css"><style>
html,body{margin:0;width:100%;height:100%}.crns-root{width:100%;height:100%;display:block!important}.crns-viewport{width:100%;height:100%}.window-app .window-content button{width:100%!important;filter:blur(2px)!important} </style></head><body>
<div class="window-app" style="height:100%"><div class="window-content" style="height:100%"><div class="crns-root theme-green"><div class="crns-viewport"><div id="host" class="crns-3d-host"></div></div></div></div></div>
<script>
game={i18n:{localize:k=>k}};
const nativeFrame=requestAnimationFrame;window.requestAnimationFrame=callback=>nativeFrame(time=>callback(window.fxFrameTime??time));
window.liveObservers=0;const NativeObserver=ResizeObserver;window.ResizeObserver=class extends NativeObserver{observe(...a){if(!this.live){this.live=true;liveObservers++}return super.observe(...a)}disconnect(){if(this.live){this.live=false;liveObservers--}super.disconnect()}};
</script><script type="module">
import{mount3D,dispose3D,inspect3D,play3DAttack}from'/modules/cyberpunk-red-netrunning-suite/scripts/apps/architecture-3d.js';
const avatar='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#73bec7"/></svg>');
const entity=(name,i)=>({ref:'ice:a:f:'+i,name,img:avatar,rez:15,rezMax:20,tip:name+' canonical effect',selectable:true});
const app={hovered:''}, calls=[];
const callbacks={onSelect:ref=>calls.push(['select',ref]),onTarget:ref=>calls.push(['target',ref]),onInspect:ref=>calls.push(['inspect',ref]),onMove:i=>calls.push(['move',i])};
const names=['Wisp','Killer','Hellhound','Skunk','Dragon','Asp','Raven','Scorpion'];
const vm={archId:'a',isGM:true,nodes:[{floorId:'f',index:0,row:1,column:1,number:1,label:'Access point',entities:names.map(entity),participants:[{...entity('Netrunner',99),ref:'runner:p',isMine:true,progMinis:[{...entity('Armor',101),ref:'prog:p:armor'},{...entity('Shield',102),ref:'prog:p:shield'}]}],demonEntities:[{...entity('Imp',100),ref:'demon:a:f:imp'}]}]};
vm.nodes[0].participants[0].color='#57c4a5';vm.nodes[0].participants[0].targetRef='ice:a:f:0';
vm.nodes[0].entities[1].owner={color:'#e679ad',name:'NPC runner'};vm.nodes[0].entities[2].tether={pid:'p'};
window.fixture={app,calls,callbacks,vm,play:event=>play3DAttack(app,event),update:data=>mount3D(app,document.getElementById('host'),data,callbacks),mount:async(data=vm)=>{await mount3D(app,document.getElementById('host'),data,callbacks);await new Promise(requestAnimationFrame)},dispose:()=>dispose3D(app),inspect:()=>inspect3D(app)};
await fixture.mount();window.ready=true;
</script></body></html>`;
  await page.route("http://net.test/**", async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path === "/") return route.fulfill({ contentType: "text/html", body: html });
    const relative = path.replace(/^\/modules\/cyberpunk-red-netrunning-suite\//, "");
    const file = resolve(root, relative);
    if (!file.startsWith(resolve(root)) || !existsSync(file)) return route.abort();
    return route.fulfill({ contentType: extname(file) === ".css" ? "text/css" : "text/javascript", body: readFileSync(file) });
  });
  await page.goto("http://net.test/"); await page.waitForFunction(() => window.ready);
  assert.equal(await page.locator('canvas.crns-3d-canvas').count(), 1);
  let info = await page.evaluate(() => fixture.inspect());
  assert.equal(info.renderer, "webgl"); assert.equal(info.models.length, 12);
  assert.ok(info.models.every(m => m.minY >= m.surface - 0.0001), "no model penetrates its platform");
  assert.ok(info.models.some(m => m.key === "runner") && info.models.some(m => m.key === "imp"));
  assert.ok(info.models.some(m => m.key === "armor"));
  const runner = info.models.find(m=>m.ref==='runner:p'), armor = info.models.find(m=>m.ref==='prog:p:armor');
  assert.equal(runner.color, '#57c4a5'); assert.equal(armor.color, runner.color);
  assert.equal(info.models.find(m=>m.key==='killer').color, '#e679ad');
  assert.ok(Math.hypot(armor.x-runner.x,armor.z-runner.z)<3.5);
  const followed = info.models.find(m=>m.key==='hellhound');
  assert.ok(Math.abs(followed.yaw-Math.atan2(runner.x-followed.x,runner.z-followed.z))<0.0001);
  const labels = page.locator('.crns-3d-entity:visible'); assert.ok(await labels.count() >= 4);
  const first = labels.first();
  assert.equal(await first.evaluate(e => getComputedStyle(e).filter), "none");
  assert.ok(await first.locator('.crns-3d-name').evaluate(e => parseFloat(getComputedStyle(e).fontSize)) >= 14);
  const rect = await first.boundingBox(); await first.hover(); assert.deepEqual(await first.boundingBox(), rect, "hover never moves/scales labels");
  const ref = await first.getAttribute('data-entity-ref');
  await first.click(); await page.waitForFunction(() => fixture.calls.some(([k])=>k==='select'));
  await first.click({button:'right'}); await page.waitForFunction(() => fixture.calls.some(([k])=>k==='target'));
  await first.dblclick(); await page.waitForFunction(() => fixture.calls.some(([k])=>k==='inspect'));
  assert.ok((await page.evaluate(() => fixture.calls)).some(c => c[1] === ref));
  const before = await page.evaluate(() => fixture.inspect().camera);
  const pointBefore = await page.evaluate(() => fixture.inspect().models[0].screen);
  await page.mouse.move(1100,650); await page.mouse.down({button:'right'}); await page.mouse.move(1030,590,{steps:4}); await page.mouse.up({button:'right'});
  await page.waitForTimeout(80);
  assert.notDeepEqual(await page.evaluate(() => fixture.inspect().camera), before, 'RMB pans the camera');
  const pointAfter = await page.evaluate(() => fixture.inspect().models[0].screen);
  assert.ok(Math.abs(pointAfter.x-pointBefore.x+70)<0.1 && Math.abs(pointAfter.y-pointBefore.y+60)<0.1, 'projected map point follows the cursor by exactly the drag delta');
  const yaw = await page.evaluate(() => fixture.inspect().camera.yaw);
  await page.locator('[data-camera="left"]').click();
  assert.notEqual(await page.evaluate(() => fixture.inspect().camera.yaw), yaw, 'first toolbar click after RMB pan is not swallowed');
  await page.waitForTimeout(80);
  const count = await page.evaluate(() => fixture.inspect().renders); await page.waitForTimeout(160);
  assert.equal(await page.evaluate(() => fixture.inspect().renders), count, "no idle rendering loop");
  assert.equal(await page.evaluate(() => fixture.inspect().bufferResizes), 1, "camera input never reallocates an unchanged drawing buffer");
  await page.evaluate(()=>{window.restoreRenderCount=fixture.inspect().renders;const gl=document.querySelector('canvas.crns-3d-canvas').getContext('webgl2');window.contextExtension=gl.getExtension('WEBGL_lose_context');contextExtension.loseContext()});
  await page.waitForTimeout(80);await page.evaluate(()=>contextExtension.restoreContext());
  await page.waitForFunction(()=>fixture.inspect().renders>restoreRenderCount);
  const canvas = await page.locator('.crns-3d-canvas').evaluate(e => { e.dataset.identity='kept';return true });
  await page.evaluate(async()=>{const host=document.getElementById('host'),fresh=host.cloneNode(false);host.replaceWith(fresh);await fixture.mount()});
  assert.equal(await page.locator('.crns-3d-canvas').getAttribute('data-identity'), 'kept', 'Foundry re-render preserves GPU context');
  const attack={id:'attack1',archId:'a',sourceRef:'prog:p:sword',ownerRef:'runner:p',targetRef:'ice:a:f:1',programName:'Sword',hit:true};
  assert.equal(await page.evaluate(event=>{window.fxFrameTime=performance.now()+240;return fixture.play(event)},attack),true);
  await page.evaluate(()=>fixture.mount());
  assert.equal(await page.evaluate(()=>fixture.inspect().effects.active),1,'ordinary Foundry redraw preserves an attack with unchanged anchors');
  assert.equal(await page.evaluate(event=>fixture.play(event),attack),false,'duplicate event does not replay');
  assert.equal(await page.evaluate(event=>fixture.play({...event,id:'hidden',targetRef:'ice:a:secret:hidden'}),attack),false,'hidden target cannot reveal itself through an effect');
  assert.equal(await page.evaluate(event=>fixture.play({...event,id:'wrongarch',archId:'other'}),attack),false);
  await page.waitForTimeout(260);
  const effect=await page.evaluate(()=>fixture.inspect().effects.effects[0]);
  assert.equal(effect.key,'sword');assert.equal(effect.hit,true);assert.equal(effect.phase,'flight');
  assert.ok(effect.from.every(Number.isFinite)&&effect.to.every(Number.isFinite));
  await page.evaluate(()=>{delete window.fxFrameTime});
  await page.waitForFunction(()=>fixture.inspect().effects.active===0);
  const idle=await page.evaluate(()=>fixture.inspect().renders);await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>fixture.inspect().renders),idle,'animation loop stops at completion');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(event=>fixture.play({...event,id:'reduced'}),attack),false);
  await page.emulateMedia({reducedMotion:'no-preference'});
  const lifecycle = await page.evaluate(async event=>{
    const vm=structuredClone(fixture.vm), owner=vm.nodes[0].participants[0];
    owner.progMinis.push(...Array.from({length:7},(_,i)=>({ref:i===6?'prog:p:sword':`prog:p:extra${i}`,name:i===6?'Sword':'Shield',selectable:true})));await fixture.mount(vm);
    const beforeOwner=fixture.inspect().models.find(m=>m.ref==='runner:p');
    window.fxFrameTime=performance.now()+150;
    const started=fixture.play({...event,id:'auto-derez'});
    owner.progMinis.pop();await fixture.mount(vm);
    const active=fixture.inspect().effects.active;
    const afterOwner=fixture.inspect().models.find(m=>m.ref==='runner:p');
    const shifted=Math.hypot(afterOwner.x-beforeOwner.x,afterOwner.z-beforeOwner.z)>0.1;
    delete window.fxFrameTime;
    await new Promise(resolve=>setTimeout(resolve,850));
    const hovered=document.querySelector('[data-entity-ref="ice:a:f:0"]');
    hovered.dispatchEvent(new PointerEvent('pointermove',{bubbles:true}));
    const before=fixture.app.hovered;
    vm.nodes[0].entities.shift();await fixture.mount(vm);
    const stale=fixture.app.hovered, tooltip=document.querySelector('.crns-3d-canvas').dataset.netTooltip;
    const count=fixture.calls.filter(c=>c[0]==='target').length;
    document.querySelector('.crns-3d-view').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyT',key:'t',bubbles:true}));
    const targeted=fixture.calls.filter(c=>c[0]==='target').length!==count;
    await fixture.mount();return {started,active,shifted,before,stale,tooltip,targeted};
  },attack);
  assert.deepEqual(lifecycle,{started:true,active:1,shifted:true,before:'ice:a:f:0',stale:'',tooltip:'',targeted:false});
  const staleSelection = await page.evaluate(async () => {
    const vm = structuredClone(fixture.vm); await fixture.mount(vm);
    const button = document.querySelector('[data-entity-ref="ice:a:f:0"]');
    const count = fixture.calls.length;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    vm.nodes[0].entities.shift(); await fixture.mount(vm);
    await new Promise(resolve => setTimeout(resolve, 350));
    const selected = fixture.calls.slice(count).some(([kind]) => kind === 'select');
    await fixture.mount(); return selected;
  });
  assert.equal(staleSelection, false, 'removed entity cannot fire a queued select callback');
  const custom = await page.evaluate(async event => {
    const vm = structuredClone(fixture.vm), floor = vm.nodes[0];
    floor.entities[0].name = 'Личный страж'; floor.entities[0].visual = { model: 'dragon', color: '#aa22bb', animation: 'auto' };
    floor.demonEntities[0].name = 'Мой демон'; floor.demonEntities[0].visual = { model: 'efreet', color: '#33aa77' };
    floor.participants[0].progMinis.push({ ref: event.sourceRef, name: 'Своя атака', visual: { model: 'hellbolt', color: '#33cc88', animation: 'superglue' } });
    await fixture.mount(vm);
    const snapshot = JSON.stringify(vm), started = fixture.play({ ...event, id: 'custom', programName: 'Своя атака' });
    const effects = fixture.inspect().effects, models = fixture.inspect().models;
    return { started, key: effects.effects[0]?.key, unchanged: snapshot === JSON.stringify(vm),
      custom: models.find(m => m.ref === 'ice:a:f:0'), demon: models.find(m => m.ref === 'demon:a:f:imp') };
  }, attack);
  assert.equal(custom.started, true); assert.equal(custom.key, 'superglue'); assert.equal(custom.unchanged, true, 'effects do not mutate game state or damage');
  assert.equal(custom.custom.key, 'dragon'); assert.equal(custom.custom.color, '#aa22bb'); assert.equal(custom.demon.key, 'efreet');
  assert.equal(await page.evaluate(event => {
    fixture.play({ ...event, id: 'custom-auto', visual: { model: 'hellbolt', animation: 'auto' }, programName: 'Свой импульс' });
    return fixture.inspect().effects.effects.at(-1).key;
  }, attack), 'hellbolt', 'auto uses a custom model key without an English name');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => fixture.inspect().effects.active === 0);
  const stopped = await page.evaluate(() => fixture.inspect().renders); await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => fixture.inspect().renders), stopped, 'enabling reduced motion stops a running effect and its frames');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async event => {
    await fixture.mount();
    if (fixture.play({ ...event, id: 'silent', visual: { animation: 'none' } })) throw Error('none must suppress FX');
    fixture.play({ ...event, id: 'fog-transition' });
    await fixture.mount({ archId: 'a', nodes: [{ floorId: 'f', index: 0, row: 1, column: 1, isFog: true }] });
  }, attack);
  assert.equal(await page.locator('.crns-3d-entity').count(), 0, 'fog removes entity HUD');
  assert.equal(await page.evaluate(() => fixture.inspect().effects.active), 0, 'fog removes effects and their endpoint information');
  await page.evaluate(() => fixture.mount());
  const output = join(root, "../../tmp/netrunning-review"); mkdirSync(output,{recursive:true});
  await page.locator('[data-camera="reset"]').click(); await page.waitForTimeout(80);
  const screenshot=process.argv.find(arg=>arg.startsWith('--screenshot='))?.slice(13);
  await page.screenshot({path:screenshot?resolve(screenshot):join(output,"webgl-architecture.png")});
  assert.equal(await page.evaluate(event=>{window.fxFrameTime=performance.now()+260;return fixture.play({...event,id:'hellbolt-visible',programName:'Hellbolt'})},attack),true);
  await page.waitForTimeout(50);await page.screenshot({path:join(output,'webgl-attack-flight.png')});
  await page.evaluate(()=>{window.fxFrameTime+=270});
  await page.waitForTimeout(50);await page.screenshot({path:join(output,'webgl-attack-impact.png')});
  await page.evaluate(()=>{delete window.fxFrameTime});
  await page.waitForFunction(()=>fixture.inspect().effects.active===0);
  const performanceReport = await page.evaluate(async()=>{
    const heavy={archId:'large',isGM:true,nodes:Array.from({length:100},(_,i)=>({floorId:'f'+i,index:i,row:i+1,column:1,parentId:i?'f'+(i-1):'',number:i+1,label:'Load test',entities:['Asp','Hellhound','Killer'].map((name,j)=>({ref:'ice:large:f'+i+':'+j,name,rez:20,rezMax:20}))}))};
    const samples=[],builds=[];
    for(let i=0;i<8;i++) {const start=performance.now();await fixture.update(heavy);builds.push(performance.now()-start);await new Promise(requestAnimationFrame);document.querySelector('canvas.crns-3d-canvas').getContext('webgl2').finish();samples.push(performance.now()-start)}
    const info=fixture.inspect();await fixture.mount();samples.sort((a,b)=>a-b);
    builds.sort((a,b)=>a-b);
    return {floors:100,models:300,buildMedianMs:+builds[4].toFixed(1),warmMedianMs:+samples[4].toFixed(1),p95Ms:+samples[7].toFixed(1),drawCalls:info.drawCalls,visibleLabels:info.models.filter(m=>m.visible).length};
  });
  const times=[];
  for (let i=0;i<5;i++) {
    const value=await page.evaluate(async()=>{
      fixture.dispose();const start=performance.now();await fixture.mount();const result=performance.now()-start;fixture.dispose();return {ms:result,observers:liveObservers,views:document.querySelectorAll('.crns-3d-view').length};
    });
    assert.equal(value.observers,0);assert.equal(value.views,0);times.push(+value.ms.toFixed(1));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({renderer:'WebGL / actual Three r172',models:info.models.length,drawCalls:info.drawCalls,contextsRetained:true,performance:performanceReport,cleanupCycles:times,errors},null,2));
  passed=true;
} catch(error) { console.error(error.stack || String(error)); throw error; }
finally {setTimeout(()=>{console.warn('Chrome shutdown timeout; assertions '+(passed?'passed':'incomplete'));process.exit(passed?0:1)},3000).unref();await browser.close();}
