/* Actual Canvas.getData + suite listeners + shell/arch HBS in offline Chrome.
 * Foundry documents, game mutations and Help/Content editors are fixture doubles.
 * node tools/integration-ui-test.mjs [--screenshot=C:/absolute/path.png]
 * Exit 1 reports integration regressions; production code is never modified.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const root = new URL("../", import.meta.url), read = p => readFileSync(new URL(p, root), "utf8");
const require = createRequire(import.meta.url);
const runtime = path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || runtime);
const foundryRoot = process.env.FOUNDRY_APP_PATH || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const files = Object.fromEntries(["constants.js", "data.js", "topology.js", "descriptions.js", "apps/arch-canvas.js", "apps/tooltips.js", "apps/equipment-panel.js", "apps/tree.js", "apps/tabs.js", "apps/editor.js", "apps/runners.js", "apps/actions.js", "apps/suite-app.js"].map(p => [p, read(`scripts/${p}`)]));
const templates = Object.fromEntries(["shell", "arch-canvas", "entity-card", "tree", "tabs", "editor", "runners", "actions", "actions-target"].map(p => [p, read(`templates/${p}.hbs`)]));
const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(p => p && existsSync(p));
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], ...(chrome ? { executablePath: chrome } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error'&&/cyberpunk-red-netrunning-suite \| (getData|activateListeners)/.test(msg.text()))errors.push(msg.text())});
  await page.route('http://net.test/**', route => {
    const relative = new URL(route.request().url()).pathname.replace(/^\/modules\/cyberpunk-red-netrunning-suite\//, '');
    if (relative === '/') return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});
    const file = new URL(relative, root);
    if (!file.href.startsWith(root.href) || !existsSync(file)) return route.abort();
    return route.fulfill({contentType:relative.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(file)});
  });
  await page.goto('http://net.test/');
  await page.setContent('<style>html,body,#fixture{width:100%;height:100%;margin:0}</style><input id="chat" style="position:fixed;z-index:200;bottom:0;right:0;width:100px"><div id="fixture" class="window-app"></div>');
  await page.addStyleTag({ content: read("styles/netrunning.css") + read("styles/architecture-3d.css") });
  await page.addScriptTag({ content: readFileSync(path.join(foundryRoot, "node_modules/jquery/dist/jquery.min.js"), "utf8") });
  await page.addScriptTag({ content: readFileSync(path.join(foundryRoot, "node_modules/handlebars/dist/handlebars.min.js"), "utf8") });
  const renderer = 'http://net.test/modules/cyberpunk-red-netrunning-suite/scripts/apps/architecture-3d.js';
  const result = await page.evaluate(async ({ files, templates, renderer, translations }) => {
    const rendererAPI = await import(renderer), calls = [], sheets = [], checks = [], findings = [];
    const expect = (condition, description) => (condition ? checks : findings).push(description);
    const img = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><path fill="#60dae0" d="M40 0 70 30 60 100 20 100 10 30Z"/></svg>');
    const actor = (id,name) => ({id,name,img,prototypeToken:{texture:{src:img}},system:{stats:{rez:{value:18,max:25},per:6,spd:6,atk:6,def:2}},sheet:{render:()=>sheets.push(id)}});
    const actors = new Map([['runner',actor('runner','Miri')],['ice',actor('ice','Hellhound')],['demon',actor('demon','Imp')]]);
    actors.filter=fn=>[...actors.values()].filter(fn);
    const users = new Map([['gm',{id:'gm',isGM:true,color:'#f6d46e',name:'GM',getFlag:(_module,key)=>key==='view3d',setFlag:async()=>{}}],['p',{id:'p',isGM:false,color:'#60dae0',name:'Player'}]]);
    users.find=fn=>[...users.values()].find(fn);
    const arch = {id:'arch',floors:[{id:'a',kind:'custom',label:'Access point',parentId:'',ice:[{id:'h',type:'hellhound',actorId:'ice'}]},{id:'b',kind:'password',parentId:'a',demon:{id:'d',type:'imp',actorId:'demon'}},{id:'c',kind:'file',parentId:'b'}]};
    const session={tabs:['arch'],activeTab:'arch',participants:{p:{kind:'runner',userId:'p',actorUuid:'Actor.runner',archId:'arch',floorIndex:0,jackedIn:true,actions:{value:3,max:3},visitedFloorIds:['a']}},attachments:[{archId:'arch',iceId:'h',pid:'p'}],cloaks:{arch:[{id:'cloak',pid:'p',n:3,dv:12}]}};
    window.game={user:users.get('gm'),users,actors,settings:{get:()=>false},i18n:{lang:'en',localize:key=>key.split('.').reduce((v,k)=>v?.[k],translations)||key,format(key,data){return this.localize(key).replace(/\{(\w+)\}/g,(_,k)=>data[k]??'')}}};
    window.fromUuidSync=uuid=>actors.get(uuid?.split('.').at(-1));
    let fixtureSerial=0;
    window.foundry={utils:{mergeObject:(a,b)=>({...a,...b}),deepClone:v=>JSON.parse(JSON.stringify(v)),randomID:()=>`fixture${++fixtureSerial}`}};
    window.Hooks={on:()=>{}};window.ui={windows:{},notifications:{warn:()=>{}}};
    window.Application=class{constructor(){}static get defaultOptions(){return{}}activateListeners(){}render(){this.fixtureRender?.()}async close(){document.querySelector('#fixture').replaceChildren()}};
    const NativeRO=ResizeObserver;let liveRO=0;
    window.ResizeObserver=class extends NativeRO{constructor(fn){super(fn);this.active=true;liveRO++}disconnect(){if(this.active){liveRO--;this.active=false}super.disconnect()}};
    function load(key,deps={}){
      const source=files[key], names=[...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m=>m[1]);
      const body=source.replace(/^import .*;\r?$/gm,'').replace('export default class NetrunningSuiteApp','class NetrunningSuiteApp').replace(/\bexport\s+/g,'');
      if(key==='apps/suite-app.js')names.push('NetrunningSuiteApp');
      return new Function('deps',`const {${Object.keys(deps)}}=deps;${body};return {${names}}`)(deps);
    }
    const constants=load('constants.js'), graph=load('topology.js'), descriptions=load('descriptions.js',constants);
    const mechanics=load('data.js',{...constants,...graph});
    const deck={id:'deck'}, programs=[{id:'armor',name:'Armor',system:{class:'defender',isRezzed:true,atk:0,def:0,rez:{value:0,max:0}}}];
    const bridge={getDeck:a=>a?.id==='runner'?deck:null,installedPrograms:()=>programs,getInterfaceRank:()=>4,netActionsMax:()=>3,eligibleNetrunner:a=>a?.id==='runner',getActorFlag:()=>true,interfaceAbilities:()=>['scanner','backdoor','cloak','control','eyedee','pathfinder','slide','virus','zap'].map(key=>({key,label:key,free:key==='scanner',meat:key==='scanner'}))};
    const shared={...constants,...graph,...mechanics,...descriptions,...rendererAPI,...bridge,getWorld:k=>k==='session'?session:k==='netArchs'?{arch}:k==='netTree'?[{id:'file',type:'arch',archId:'arch',name:'Fixture architecture',parentId:''}]:{},mutate:async(op,payload)=>{calls.push({op,payload});return {ok:true}},isPlayerRunner:p=>p.kind==='runner'&&p.userId==='p'};
    const Canvas=load('apps/arch-canvas.js',shared), tooltip=load('apps/tooltips.js');
    const Equipment=load('apps/equipment-panel.js',{...shared,bridge,equipmentProfile:()=>({keys:[],range:6}),equipmentHint:()=>''});
    const Tree=load('apps/tree.js',{...shared,promptText:async()=>null,snapshotEntityActor:()=>null}), Tabs=load('apps/tabs.js',shared), Editor=load('apps/editor.js',shared);
    const Actions=load('apps/actions.js',{...shared,bridge,equipmentProfile:()=>({keys:[],range:6}),equipmentDamageFormula:(_s,_r,_b,f)=>f});
    const Runners=load('apps/runners.js',{...shared,confirmDisconnect:Actions.confirmDisconnect});
    const inert={getData:()=>({}),activateListeners:()=>{}};
    const {NetrunningSuiteApp}=load('apps/suite-app.js',{...shared,...tooltip,Canvas,Equipment,Tree,Tabs,Editor,Runners,Actions,Help:inert,Content:inert,userNetrunnerActor:()=>actors.get('runner'),isSpectatableRunner:()=>true});
    Handlebars.registerHelper('localize',k=>game.i18n.localize(k));
    Handlebars.registerHelper('crnsOr',(a,b)=>a||b);Handlebars.registerHelper('crnsEq',(a,b)=>a===b);
    Handlebars.registerHelper('crnsAnd',(a,b)=>a&&b);Handlebars.registerHelper('crnsGt',(a,b)=>Number(a)>Number(b));
    Handlebars.registerHelper('crnsIncludes',(a,b)=>Array.isArray(a)&&a.includes(b));Handlebars.registerHelper('crnsConcat',(...args)=>args.slice(0,-1).join(''));
    for(const [name,text] of Object.entries(templates))Handlebars.registerPartial(`modules/${constants.MODULE_ID}/templates/${name}.hbs`,text);
    Handlebars.registerPartial(`modules/${constants.MODULE_ID}/templates/help.hbs`,'');
    const shell=Handlebars.compile(templates.shell), app=new NetrunningSuiteApp();
    const render=()=>{
      const data=app.getData();document.querySelector('#fixture').innerHTML=shell(data);
      app.element=$('#fixture');app.activateListeners($('.crns-root'));
      expect(data.canvas===app._canvasVM,'getData passes exact same canvas VM');return data;
    };
    const settle=async()=>{for(let i=0;i<100&&!rendererAPI.inspect3D(app);i++)await new Promise(r=>setTimeout(r,20));await new Promise(requestAnimationFrame)};
    app.fixtureRender=render;render();await settle();
    game.combat={id:'combat',round:1,turn:0,started:true,combatant:{id:'runnerTurn',actorId:'runner',actor:actors.get('runner')}};
    session.programUsage={'Actor.runner':{round:'combat:1',ids:{armor:true}}};
    render();await settle();
    const overlaysClear=()=>document.querySelector('.crns-cloak-strip').getBoundingClientRect().top>=document.querySelector('.crns-current-turn-label').getBoundingClientRect().bottom+4;
    expect(overlaysClear(),'3D initiative header does not cover the Cloak controls');
    expect(document.querySelector('[data-entity-ref="runner:p"]').classList.contains('is-current-turn'),'3D runner shows the current initiative turn');
    expect(document.querySelector('.crns-current-turn-label')?.textContent.includes('Miri'),'turn header names a visible runner');
    expect(document.querySelector('[data-entity-ref="prog:p:armor"] .crns-3d-used-badge')?.textContent==='Used','3D program shows its per-copy used badge');
    app.state.view3d=false;render();
    expect(overlaysClear(),'2D initiative header does not cover the Cloak controls');
    expect(document.querySelector('[data-entity-ref="runner:p"]').classList.contains('crns-current-turn'),'2D runner shows the same initiative turn');
    expect(!!document.querySelector('[data-entity-ref="prog:p:armor"] .crns-used-badge'),'2D program keeps its used badge');
    expect(getComputedStyle(document.querySelector('[data-entity-ref="runner:p"]')).outlineStyle==='solid','turn outline survives native CSS');
    app.state.view3d=true;game.combat.combatant={id:'iceTurn',actorId:'ice',actor:actors.get('ice')};render();await settle();
    expect(document.querySelector('[data-entity-ref="ice:arch:a:h"]').classList.contains('is-current-turn'),'3D ICE shows its own turn');
    expect(!document.querySelector('[data-entity-ref="runner:p"]').classList.contains('is-current-turn'),'owner is not marked during a program turn');
    game.combat.round=2;render();await settle();
    expect(!document.querySelector('[data-entity-ref="prog:p:armor"] .crns-3d-used-badge'),'used badge clears on the next round');
    game.combat.started=false;render();await settle();
    expect(!document.querySelector('.crns-current-turn-label')&&!document.querySelector('.is-current-turn'),'ending combat clears turn markers');
    expect(document.querySelectorAll('.crns-3d-host').length===1&&!document.querySelector('.crns-stage'),'3D HBS renders one host and no 2D stage');
    expect(document.querySelectorAll('.crns-effect-tooltip').length===1,'one delegated tooltip');
    expect(document.querySelector('[data-entity-ref="ice:arch:a:h"]').dataset.netTooltip.includes('PER 6'),'actual ICE effect/stats tooltip reaches billboard');
    const sprite=ref=>document.querySelector('[data-entity-ref="'+ref+'"]');
    sprite('ice:arch:a:h').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    expect(sheets.includes('ice'),'ICE native inspection resolves actor');
    sprite('runner:p').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    expect(sheets.includes('runner'),'REGRESSION: runner inspection must resolve backing actor');
    expect(!!app._canvasVM.nodes[0].entities[0].tether,'fixture has an attached ICE tether');
    expect(!!document.querySelector('.crns-3d-tether'),'REGRESSION: visible attached ICE must have tether endpoint metadata');
    const count=calls.length;document.querySelector('[data-action="fx-clear-cloak"]').click();
    expect(calls.length>count&&calls.at(-1).op==='fx.clear','REGRESSION: GM cloak clear remains active in 3D');
    app.state.selection='runner:p';render();await settle();document.querySelector('[data-move-index="1"]').click();
    expect(calls.at(-1)?.op==='session.move'&&calls.at(-1).payload.pid==='p','GM move callback resolves selected runner');
    const spriteStyle=getComputedStyle(sprite('runner:p'));
    const toolbarHeight=document.querySelector('[data-camera="in"]').getBoundingClientRect().height;
    expect(spriteStyle.borderTopWidth!=='0px'&&parseFloat(spriteStyle.width)>=102&&toolbarHeight>=24,
      `REGRESSION: shared button reset overrides 3D CSS (selected border ${spriteStyle.borderTopWidth}, billboard width ${spriteStyle.width}, zoom hit height ${toolbarHeight.toFixed(1)}px)`);
    sprite('prog:p:armor').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
    expect(!document.querySelector('.crns-effect-tooltip').hidden,'delegated tooltip handles mounted program mini');
    expect(!document.querySelector('.crns-effect-tooltip').textContent.includes('[object'),'tooltip content remains plain text');
    for(let i=0;i<20;i++){render();await settle()}
    expect(liveRO===1&&document.querySelectorAll('.crns-3d-view').length===1,'20 parent re-renders leave one view/observer');
    const camera=JSON.stringify(rendererAPI.inspect3D(app).camera);
    document.querySelector('[data-camera="right"]').click();const moved=JSON.stringify(rendererAPI.inspect3D(app).camera);render();await settle();
    expect(moved!==camera&&JSON.stringify(rendererAPI.inspect3D(app).camera)===moved,'parent re-render preserves camera');
    // Real template toggle traverses both lifecycle paths.
    document.querySelector('[data-action="view-toggle"]').click();await settle();
    expect(!!document.querySelector('.crns-stage')&&!document.querySelector('.crns-3d-view'),'3D -> 2D switches DOM exclusively');
    document.querySelector('[data-action="view-toggle"]').click();await settle();
    expect(!!document.querySelector('.crns-3d-view')&&!document.querySelector('.crns-stage')&&!app._rainRaf,'2D -> 3D stops rain and removes old stage');
    expect(liveRO===1,'2D -> 3D observer count stable');
    const selected=app.state.selection;
    game.user=users.get('p');app.state.selection='';render();await settle();
    expect(!document.querySelector('.crns-tree')&&!document.querySelector('.crns-runners'),'player has no GM tree/roster controls');
    expect(document.querySelectorAll('[data-action="ability-roll"]').length===9&&!document.querySelector('.crns-cloak-x'),'player has own action bar and cannot clear Cloak');
    expect(!document.querySelector('[data-entity-ref="demon:arch:b:d"]'),'player does not see a demon on an undiscovered floor');
    users.set('s',{id:'s',isGM:false,name:'Spectator'});session.participants.s={kind:'spectator',userId:'s',archId:'arch',followPid:'p'};
    game.user=users.get('s');render();await settle();
    expect(!document.querySelector('[data-action="ability-roll"]')&&!document.querySelector('.crns-cloak-strip'),'spectator has no NET actions or runner Cloak strip');
    expect(!document.querySelector('[data-entity-ref="demon:arch:b:d"]'),'spectator preserves the followed runner fog');
    game.user=users.get('gm');delete session.participants.s;app.state.selection=selected;render();await settle();
    window.integrated={app,render,Canvas,session,actors,calls,checks,findings,get liveRO(){return liveRO}};
    return {checks:checks.length,findings};
  }, { files, templates, renderer, translations: JSON.parse(read('lang/en.json')) });
  const check=(condition,description)=>{if(condition)result.checks++;else result.findings.push(description)};
  check(await page.locator('[data-action="arch-edit"]').count()===1,'full shell renders the real tree and tab templates');
  await page.locator('[data-action="tab-edit"]').click();
  check(await page.locator('.crns-editor-body').count()===1&&!await page.locator('.crns-3d-view').count(),'tab edit mounts the real editor and disposes the 3D view');
  await page.locator('[data-action="editor-name"]').fill('Renamed fixture');
  await page.locator('[data-action="editor-name"]').press('Tab');
  await page.locator('[data-action="floor-insert"]').last().click();
  await page.locator('[data-action="editor-save"]').click();
  const saved=await page.evaluate(()=>integrated.calls.findLast(c=>c.op==='arch.update'));
  check(saved?.payload.arch.name==='Renamed fixture'&&saved.payload.arch.floors.length===4,'real editor submits the renamed four-floor draft');
  await page.locator('[data-action="editor-cancel"]').click();
  check(!await page.locator('.crns-editor-body').count()&&await page.locator('.crns-3d-view').count()===1,'cancel returns from the editor to the architecture view');
  await page.locator('[data-action="runners-toggle"]').click();
  await page.locator('[data-action="runner-act"]').click();
  check(await page.locator('[data-action="ability-roll"]').count()===9&&await page.locator('.crns-prog-row').count()===1,'roster selection mounts the real runner action bar and program rows');
  await page.locator('[data-entity-ref="ice:arch:a:h"]').click();
  await page.locator('[data-action="ice-follow"]').waitFor({state:'visible',timeout:3000});
  check(await page.locator('[data-action="ice-follow"]').count()===1&&await page.locator('[data-action="entity-damage"]').count()===1,'ICE selection mounts its stats, damage and follow controls');
  await page.evaluate(()=>{integrated.app.state.selection='demon:arch:b:d';integrated.render()});
  check(await page.locator('[data-action="demon-zap"]').count()===1&&await page.locator('[data-action="demon-cn"]').count()===1,'Demon selection mounts its Zap and Combat Number controls');
  await page.locator('[data-action="runner-act"]').click();
  await page.locator('[data-action="runners-toggle"]').click();
  // Real pointer sequence: viewport capture must not swallow a Cloak action.
  // The fixture omits Foundry's icon font; supply the cross glyph's hit area.
  await page.addStyleTag({content:'.crns-cloak-x::before{content:"×"}'});
  for(const view3d of [false,true]){
    await page.evaluate(view3d=>{integrated.app.state.view3d=view3d;integrated.render()},view3d);
    const cloakCalls=await page.evaluate(()=>integrated.calls.length);
    await page.locator('.crns-cloak-x').click({timeout:5000});
    const cloakResult=await page.evaluate(()=>({count:integrated.calls.length,call:integrated.calls.at(-1)}));
    if(cloakResult.count!==cloakCalls+1||cloakResult.call.op!=='fx.clear'||cloakResult.call.payload.archId!=='arch'||cloakResult.call.payload.kind!=='cloak'||cloakResult.call.payload.id!=='cloak')result.findings.push(`REGRESSION: real ${view3d?'3D':'2D'} Cloak cross click must clear the selected arch-level marker`);
    else result.checks++;
    if(!view3d){
      const pan=await page.evaluate(()=>{const r=document.querySelector('.crns-viewport').getBoundingClientRect();return {x:r.left+20,y:r.top+r.height*.7,cam:{...integrated.app.state.cam.arch}}});
      await page.mouse.move(pan.x,pan.y);await page.mouse.down();await page.mouse.move(pan.x+30,pan.y+20);await page.mouse.up();
      const moved=await page.evaluate(()=>integrated.app.state.cam.arch);
      if(Math.abs(moved.x-pan.cam.x-30)>.1||Math.abs(moved.y-pan.cam.y-20)>.1||moved.z!==pan.cam.z)result.findings.push('REGRESSION: excluding Cloak actions from pan must preserve empty-space dragging');
      else result.checks++;
    }
  }
  // Real focus path: starting to type in chat must not be interrupted by hover.
  await page.locator('#chat').focus();
  await page.locator('[data-entity-ref="runner:p"]').hover();
  if (await page.evaluate(() => document.activeElement.id!=='chat')) result.findings.push('REGRESSION: 3D hover steals keyboard focus from an actively focused external chat input');
  // Zoomed text/images must match a fresh render at the same camera position.
  await page.mouse.move(1170, 750);
  await page.evaluate(async()=>{
    const f=integrated;f.app.state.view3d=false;f.render();
    await new Promise(requestAnimationFrame);
    const chip=document.querySelector('[data-entity-ref="ice:arch:a:h"]');
    const viewport=chip.closest('.crns-viewport'), box=chip.getBoundingClientRect(), view=viewport.getBoundingClientRect();
    const cam=f.app.state.cam.arch;cam.x+=view.left+view.width/2-box.left-box.width/2;cam.y+=view.top+view.height/2-box.top-box.height/2;
    f.render();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    document.querySelector('[data-action="cam-zoom-in"]').click();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    document.querySelector('[data-action="cam-zoom-in"]').click();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  });
  const zoomChip=page.locator('[data-entity-ref="ice:arch:a:h"]');
  if(await page.locator('.crns-stage').evaluate(el=>getComputedStyle(el).willChange)!=='auto')result.findings.push('REGRESSION: 2D stage forces a cached transform layer across zoom levels');
  else result.checks++;
  const zoomBefore=await zoomChip.screenshot({animations:'disabled'});
  const zoomCamera=await page.evaluate(()=>JSON.stringify(integrated.app.state.cam.arch));
  await page.evaluate(async()=>{integrated.render();await new Promise(requestAnimationFrame)});
  const zoomAfter=await zoomChip.screenshot({animations:'disabled'});
  const rasterDifference=await page.evaluate(async pngs=>{
    const images=await Promise.all(pngs.map(src=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.src='data:image/png;base64,'+src})));
    if(images[0].width!==images[1].width||images[0].height!==images[1].height)return 255;
    const pixels=images.map(img=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height).data});
    let difference=0;for(let i=0;i<pixels[0].length;i+=4)for(let channel=0;channel<3;channel++)difference+=Math.abs(pixels[0][i+channel]-pixels[1][i+channel]);
    return difference/(images[0].width*images[0].height*3);
  },[zoomBefore.toString('base64'),zoomAfter.toString('base64')]);
  result.zoomRasterMeanDifference=rasterDifference;
  // Allow minor GPU color rounding, while rejecting a resampled text/image layer.
  if(rasterDifference>0.25)result.findings.push('REGRESSION: 2D zoom text/images change raster quality after a parent render');
  else result.checks++;
  if(await page.evaluate(()=>JSON.stringify(integrated.app.state.cam.arch))!==zoomCamera)result.findings.push('REGRESSION: 2D parent render changes zoom/pan');
  else result.checks++;
  await page.evaluate(async()=>{integrated.app.state.view3d=true;integrated.render();await new Promise(requestAnimationFrame)});
  const screenshot=process.argv.find(a=>a.startsWith('--screenshot='))?.slice(13);
  if(screenshot){
    await page.evaluate(async()=>{
      const f=integrated;game.combat={id:'preview',round:1,turn:0,started:true,combatant:{id:'runnerTurn',actorId:'runner',actor:f.actors.get('runner')}};
      f.session.programUsage={'Actor.runner':{round:'preview:1',ids:{armor:true}}};f.render();await new Promise(requestAnimationFrame);
    });
    await page.screenshot({path:path.resolve(screenshot)});console.log(`Screenshot: ${path.resolve(screenshot)}`)
  }
  const cleanup=await page.evaluate(async()=>{const f=window.integrated;await f.app.close();return {observers:f.liveRO,tooltipDisposer:f.app._disposeNetTooltips,views:document.querySelectorAll('.crns-3d-view').length}});
  if(cleanup.observers!==0||cleanup.views!==0||cleanup.tooltipDisposer!==null)result.findings.push('close leaked viewport/tooltip resources');
  if(errors.length)result.findings.push(...errors);
  console.log(JSON.stringify({...result,cleanup,browser:browser.version()},null,2));
  if(result.findings.length)process.exitCode=1;
} finally {setTimeout(()=>process.exit(process.exitCode||0),3000).unref();await browser.close()}
