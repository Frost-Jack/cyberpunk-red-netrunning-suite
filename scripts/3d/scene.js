import { THREE } from "./model-kit.js";
import { modelAsset, entityModelKey, entityVisual, retainModelAssets, releaseModelAssets } from "./models.js";
import { layoutArchitecture } from "./layout.js";
import { panCamera, facingYaw, affiliationColor } from "./presentation.js";
import { createAttackEffects } from "./attack-effects.js";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const defaults = { reset: "Entry", zoomIn: "Zoom in", zoomOut: "Zoom out", orbitLeft: "Orbit left", orbitRight: "Orbit right", move: "Move here", fog: "Unexplored", demon: "DEMON", selected: "Selected", target: "Target", trap: "TRAP", chase: "CHASE", deployed: "DEPLOYED", help: "Drag: orbit · Right / middle drag: pan · Wheel: zoom · T: target" };
const make = (tag, className, text) => { const e = document.createElement(tag); e.className = className; if (text !== undefined) e.textContent = text; return e; };
const vector = p => new THREE.Vector3(p.x, p.y, p.z);

export function createScene(app, host, vm, callbacks, cameraRecords) {
  const root = make("section", "crns-3d-view"); root.tabIndex = 0;
  const canvas = make("canvas", "crns-3d-canvas");
  const overlay = make("div", "crns-3d-overlay"), toolbar = make("nav", "crns-3d-toolbar");
  const help = make("p", "crns-3d-help");
  root.append(canvas, overlay, toolbar, help); host.append(root);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" }); }
  catch (error) { root.remove(); throw error; }
  retainModelAssets();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x030d17); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), world = new THREE.Group(); scene.add(world);
  const effectWorld = new THREE.Group(); scene.add(effectWorld);
  const effects = createAttackEffects(effectWorld);
  scene.add(new THREE.AmbientLight(0xc7e4ee, 2.2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(-30, 80, 50); scene.add(light);
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 10000);
  const solidMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 20, side: THREE.DoubleSide });
  const wireMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false });
  const floorMaterial = new THREE.MeshPhongMaterial({ color: 0x0a2531, flatShading: true });
  const fogMaterial = new THREE.MeshPhongMaterial({ color: 0x132332, flatShading: true });
  const gridMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  const platformGeometry = new THREE.BoxGeometry(1, 1, 1);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const state = { app, root, canvas, overlay, toolbar, help, renderer, scene, camera,
    cameras: cameraRecords, abort: new AbortController(), geometries: [], modelMeshes: [], platformMeshes: [],
    records: [], floors: [], labels: [], disposed: false, frame: null, selectTimer: null, dragged: false,
    cameraState: null, archId: null, hoverRef: "", renders: 0, bufferResizes: 0, width: 0, height: 0, labelsDirty: true, facings: new Map(), attacks: new Set(), attackAnchors: [] };
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  motion?.addEventListener("change", () => { if (motion.matches) { effects.clear(); state.attackAnchors = []; requestDraw(false); } }, { signal: state.abort.signal });

  function clearWorld() {
    for (const child of world.children) if (child.isInstancedMesh) child.dispose();
    world.clear();
    for (const geometry of state.geometries) geometry.dispose();
    state.geometries = []; state.modelMeshes = []; state.platformMeshes = [];
    overlay.replaceChildren(); state.records = []; state.labels = [];
  }
  function lines(vertices, colors) {
    if (!vertices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    state.geometries.push(geometry); world.add(new THREE.LineSegments(geometry, gridMaterial));
  }
  function label(record) {
    const e = record.entity, button = make("button", `crns-3d-entity crns-3d-${record.kind}`);
    button.type = "button"; button.hidden = true; button.dataset.entityRef = e.ref;
    button.dataset.netTooltip = e.tip || e.tooltip || e.effect || "";
    button.classList.toggle("is-selected", !!e.selected); button.classList.toggle("is-targeted", !!e.targets?.length);
    button.classList.toggle("is-derezzed", !!e.derezzed); button.setAttribute("aria-pressed", String(!!e.selected));
    button.classList.toggle("is-current-turn", !!e.isCurrentTurn); button.classList.toggle("is-used", !!e.used);
    button.style.setProperty("--sprite-color", affiliationColor(e, record.kind));
    const name = make("span", "crns-3d-name", e.name || e.code || e.ref);
    const top = make("span", "crns-3d-ident");
    if (e.img) { const img = make("img", "crns-3d-avatar"); img.src = e.img; img.alt = ""; img.draggable = false; top.append(img); }
    top.append(name); button.append(top);
    if (e.isCurrentTurn) button.append(make("span", "crns-3d-turn-badge", state.labelsText.turn || "Turn"));
    if (e.used) { const badge = make("span", "crns-3d-used-badge", state.labelsText.used || "Used"); badge.title = state.labelsText.usedHint || "Activated this round"; button.append(badge); }
    if (e.rezMax > 0 || e.hpMax > 0) {
      const max = e.rezMax || e.hpMax, current = e.rezMax ? e.rez : e.hp;
      button.append(make("span", "crns-3d-stats", `${e.rezMax ? "REZ" : "HP"} ${current}/${max}`));
      const meter = make("span", "crns-3d-meter"), fill = make("i", "");
      fill.style.width = `${clamp(Number(current) / max * 100 || 0, 0, 100)}%`; meter.append(fill); button.append(meter);
    }
    if (e.owner) button.append(make("span", "crns-3d-owner", e.owner.name));
    if (record.kind === "demon") button.append(make("span", "crns-3d-badge", state.labelsText.demon));
    if (e.tether) { const badge = make("span", "crns-3d-tether", state.labelsText.link || "LINK"); badge.title = e.tether.title || ""; button.append(badge); }
    if (e.slid) button.append(make("span", "crns-3d-badge", state.labelsText.slid || "SLIDE"));
    if (e.isTrap || e.isChasing || e.isDeployed) button.append(make("span", "crns-3d-badge", e.isChasing ? state.labelsText.chase : e.isTrap ? state.labelsText.trap : state.labelsText.deployed));
    overlay.append(button); record.button = button; state.labels.push(record);
  }
  function rebuild(data) {
    clearWorld(); state.floors = layoutArchitecture(data.nodes || []);
    const batches = new Map(), vertices = [], colors = [];
    const segment = (a, b, color = 0x245669) => {
      const c = new THREE.Color(color); vertices.push(a.x, a.y, a.z, b.x, b.y, b.z); colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const platforms = [], fog = [];
    for (const floor of state.floors) {
      (floor.node.isFog ? fog : platforms).push({ ...floor, surface: floor.y, height: 0.44 });
      const top = floor.y + 0.025;
      for (let x = -floor.width / 2; x <= floor.width / 2; x += 2) segment({ x: floor.x + x, y: top, z: floor.z - floor.depth / 2 }, { x: floor.x + x, y: top, z: floor.z + floor.depth / 2 });
      for (let z = -floor.depth / 2; z <= floor.depth / 2; z += 2) segment({ x: floor.x - floor.width / 2, y: top, z: floor.z + z }, { x: floor.x + floor.width / 2, y: top, z: floor.z + z });
      const header = make("div", "crns-3d-floor-label"); header.hidden = true;
      header.append(make("strong", "", floor.node.isFog ? state.labelsText.fog : `${floor.node.number ?? floor.node.index + 1} / ${floor.node.label || ""}`));
      if (!floor.node.isFog && floor.node.showDv) header.append(make("span", "", `DV ${floor.node.dv}`));
      if (floor.node.showMoveHere || data.isGM) {
        const move = make("button", "crns-3d-move", state.labelsText.move); move.type = "button"; move.dataset.moveIndex = floor.node.index; header.append(move);
      }
      overlay.append(header); floor.label = header;
      for (const record of floor.entities) {
        const key = entityModelKey(record.entity, record.kind); record.modelKey = key;
        record.asset = modelAsset(key); record.entityRef = record.entity.ref;
        const batchKey = `${floor.node.floorId}:${key}`;
        if (!batches.has(batchKey)) batches.set(batchKey, []); batches.get(batchKey).push(record);
        state.records.push(record); label(record);
        if (record.pedestal) {
          platforms.push({ x: record.x, y: floor.y, z: record.z, surface: floor.y + 0.3, height: 0.6, width: 4, depth: 4 });
          segment({ x: record.x + 2, y: floor.y + 0.1, z: record.z }, { x: floor.x - floor.width / 2, y: floor.y + 0.1, z: record.z }, 0x996d35);
        }
      }
    }
    for (const [entries, material] of [[platforms, floorMaterial], [fog, fogMaterial]]) {
      if (!entries.length) continue;
      const mesh = new THREE.InstancedMesh(platformGeometry, material, entries.length);
      entries.forEach((p, i) => { matrix.compose(new THREE.Vector3(p.x, p.surface - p.height / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(p.width, p.height, p.depth)); mesh.setMatrixAt(i, matrix); });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.userData.platforms = entries;
      state.platformMeshes.push(mesh); world.add(mesh);
    }
    const refs = new Map(state.records.map(r => [r.entity.ref, r]));
    if (state.selectRef && !refs.has(state.selectRef)) { clearTimeout(state.selectTimer); state.selectRef = ""; }
    if (state.hoverRef) {
      const hovered = refs.get(state.hoverRef);
      if (!hovered) hover(null);
      else canvas.dataset.netTooltip = hovered.entity.tip || "";
    }
    if (state.drag?.record && !refs.has(state.drag.record.entity.ref)) state.drag.record = null;
    for (const records of batches.values()) {
      const asset = modelAsset(records[0].modelKey), mesh = new THREE.InstancedMesh(asset.geometry, solidMaterial, records.length);
      const wire = new THREE.InstancedMesh(asset.geometry, wireMaterial, records.length);
      records.forEach((r, i) => {
        const owner = refs.get(r.entity.ownerRef);
        const targetRef = r.entity.targetRef || (r.entity.tether ? `runner:${r.entity.tether.pid}` : "") || owner?.entity.targetRef;
        r.yaw = facingYaw(r, refs.get(targetRef), state.facings.get(r.entity.ref) ?? owner?.yaw ?? 0);
        state.facings.set(r.entity.ref, r.yaw);
        r.color = affiliationColor(r.entity, r.kind);
        quaternion.setFromAxisAngle(up, r.yaw);
        matrix.compose(new THREE.Vector3(r.x, r.y, r.z), quaternion, new THREE.Vector3(r.scale, r.scale, r.scale));
        mesh.setMatrixAt(i, matrix); wire.setMatrixAt(i, matrix);
        r.mesh = mesh; r.wire = wire; r.instance = i;
        const tint = r.entity.derezzed ? new THREE.Color(0x424c55) : new THREE.Color(0xffffff).lerp(new THREE.Color(r.color), 0.55);
        mesh.setColorAt(i, tint); wire.setColorAt(i, new THREE.Color(r.color));
        const radius = r.scale * 1.1;
        for (let step = 0; step < 24; step++) {
          const a = step * Math.PI / 12, b = (step + 1) * Math.PI / 12;
          segment({ x: r.x + Math.sin(a) * radius, y: r.y + 0.025, z: r.z + Math.cos(a) * radius },
            { x: r.x + Math.sin(b) * radius, y: r.y + 0.025, z: r.z + Math.cos(b) * radius }, r.color);
        }
      });
      mesh.instanceMatrix.needsUpdate = true; wire.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere(); wire.computeBoundingSphere(); mesh.userData.records = records;
      world.add(mesh, wire); state.modelMeshes.push(mesh);
    }
    const byFloor = new Map(state.floors.map(f => [f.node.floorId, f]));
    for (const floor of state.floors) {
      const parent = byFloor.get(floor.node.parentId); if (!parent) continue;
      const a = { x: parent.x, y: parent.y, z: parent.z + parent.depth / 2 };
      const b = { x: floor.x, y: floor.y, z: floor.z - floor.depth / 2 };
      const middle = { x: a.x, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      segment(a, middle, 0x368da2); segment(middle, b, 0x368da2);
    }
    for (const ref of state.facings.keys()) if (!refs.has(ref)) state.facings.delete(ref);
    if (state.attackAnchors.some(anchor => {
      const record = refs.get(anchor.ref);
      return !record || record.floor.node.floorId !== anchor.floorId;
    })) { effects.clear(); state.attackAnchors = []; }
    for (const r of state.records) {
      const target = refs.get(r.entity.targetRef || (r.entity.tether ? `runner:${r.entity.tether.pid}` : "")); const owner = refs.get(r.entity.ownerRef);
      for (const [other, color] of [[target, 0xed8a5c], [owner, owner?.color || 0x587d8c]]) {
        if (!other) continue;
        const a = { x: r.x, y: r.y + 1.7, z: r.z }, b = { x: other.x, y: other.y + 1.7, z: other.z };
        const high = Math.max(a.y, b.y) + 2, middle = { x: (a.x + b.x) / 2, y: high, z: (a.z + b.z) / 2 };
        segment(a, middle, color); segment(middle, b, color);
      }
    }
    lines(vertices, colors);
  }
  function setCamera() {
    const width = root.clientWidth || 1, height = root.clientHeight || 1, c = state.cameraState;
    const half = 13 / c.zoom; camera.left = -half * width / height; camera.right = -camera.left; camera.top = half; camera.bottom = -half;
    camera.position.set(c.x + Math.sin(c.yaw) * Math.cos(c.elevation) * 150, c.y + Math.sin(c.elevation) * 150, c.z + Math.cos(c.yaw) * Math.cos(c.elevation) * 150);
    camera.lookAt(c.x, c.y, c.z); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    if (width !== state.width || height !== state.height) {
      renderer.setSize(width, height, false); state.width = width; state.height = height; state.bufferResizes++;
    }
  }
  function projected(p) {
    const v = vector(p).project(camera);
    return { x: (v.x + 1) * root.clientWidth / 2, y: (1 - v.y) * root.clientHeight / 2, depth: v.z };
  }
  function hiddenByFloor(record) {
    const target = new THREE.Vector3(record.x, record.y + 1.1 * record.scale, record.z);
    const direction = target.clone().sub(camera.position); const distance = direction.length();
    raycaster.set(camera.position, direction.normalize());
    const hit = raycaster.intersectObjects(state.platformMeshes, false)[0];
    return !!hit && hit.distance < distance - 0.15;
  }
  function placeLabels() {
    const occupied = [], w = root.clientWidth, h = root.clientHeight;
    const intersects = (a, b) => a.x < b.x + b.w + 6 && a.x + a.w + 6 > b.x && a.y < b.y + b.h + 4 && a.y + a.h + 4 > b.y;
    for (const floor of state.floors) {
      const p = projected({ x: floor.x, y: floor.y + 0.1, z: floor.z + floor.depth / 2 + 1.2 });
      floor.label.hidden = p.x < -200 || p.x > w + 200 || p.y < -100 || p.y > h + 160 || Math.abs(p.depth) > 1;
      const x = clamp(p.x, 140, Math.max(140, w - 140)), y = clamp(p.y, 8, Math.max(8, h - 120));
      floor.label.style.left = `${x}px`; floor.label.style.top = `${y}px`;
      if (!floor.label.hidden) occupied.push({ x: x - 135, y, w: 270, h: floor.label.offsetHeight });
    }
    for (const r of state.labels) {
      const p = projected({ x: r.x, y: r.y + r.asset.bounds.max.y * r.scale + 0.2, z: r.z });
      const b = r.button;
      if (p.x < -180 || p.x > w + 180 || p.y < -120 || p.y > h + 120 || Math.abs(p.depth) > 1) { b.hidden = true; continue; }
      b.hidden = false;
      const size = { w: b.offsetWidth || 146, h: b.offsetHeight || 60 };
      const desired = { x: Math.round(p.x - size.w / 2), y: Math.round(p.y - size.h - 5), ...size };
      const candidates = [desired, { ...desired, y: desired.y - size.h - 10 }, { ...desired, x: desired.x + size.w / 2 + 12 }, { ...desired, x: desired.x - size.w / 2 - 12 },
        { ...desired, y: desired.y - 2 * (size.h + 10) }, { ...desired, x: desired.x + size.w + 12 }, { ...desired, x: desired.x - size.w - 12 }];
      const rect = candidates.find(a => a.x >= 4 && a.x + a.w <= w - 4 && a.y >= 4 && a.y + a.h < h - 58 && !occupied.some(other => intersects(a, other)));
      b.hidden = !rect || Math.abs(p.depth) > 1 || hiddenByFloor(r);
      if (!b.hidden) { b.style.left = `${rect.x}px`; b.style.top = `${rect.y}px`; occupied.push(rect); }
    }
  }
  function draw(now) {
    state.frame = null; if (state.disposed || !root.isConnected || !root.clientHeight) return;
    const animating = effects.update(now);
    setCamera(); renderer.render(scene, camera); state.renders++;
    if (state.labelsDirty) { placeLabels(); state.labelsDirty = false; }
    if (animating) requestDraw(false); else state.attackAnchors = [];
  }
  function requestDraw(labels = true) {
    if (labels !== false) state.labelsDirty = true;
    if (!state.disposed && state.frame === null) state.frame = requestAnimationFrame(draw);
  }
  canvas.addEventListener("webglcontextrestored", requestDraw, { signal: state.abort.signal });
  function pick(event) {
    const direct = event.target.closest?.("[data-entity-ref]")?.dataset.entityRef;
    if (direct) return state.records.find(r => r.entity.ref === direct);
    if (event.target !== canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const model = raycaster.intersectObjects(state.modelMeshes, false)[0];
    if (!model) return null;
    const floor = raycaster.intersectObjects(state.platformMeshes, false)[0];
    return floor && floor.distance < model.distance ? null : model.object.userData.records[model.instanceId];
  }
  function hover(record) {
    const ref = record?.entity.ref || ""; if (ref === state.hoverRef) return;
    state.hoverRef = ref; app.hovered = ref;
    canvas.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    canvas.dataset.netTooltip = record?.entity.tip || "";
    if (ref) canvas.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const active = document.activeElement, windowElement = root.closest(".window-app") || root;
    if (ref && !active?.closest("input,textarea,select,[contenteditable]")
      && (active === document.body || !windowElement.contains(active))) root.focus({ preventScroll: true });
  }
  const listen = (event, fn, options = {}) => root.addEventListener(event, fn, { ...options, signal: state.abort.signal });
  listen("click", event => {
    event.stopPropagation();
    if (state.dragged && !event.target.closest("button")) { state.dragged = false; return; }
    state.dragged = false;
    const move = event.target.closest("[data-move-index]");
    if (move) { state.callbacks.onMove?.(Number(move.dataset.moveIndex)); return; }
    const action = event.target.closest("[data-camera]")?.dataset.camera, c = state.cameraState;
    if (action) {
      if (action === "reset") Object.assign(c, state.entryCamera);
      if (action === "left") c.yaw -= 0.2; if (action === "right") c.yaw += 0.2;
      if (action === "in") c.zoom = clamp(c.zoom * 1.2, 0.35, 2.5); if (action === "out") c.zoom = clamp(c.zoom / 1.2, 0.35, 2.5);
      requestDraw(); return;
    }
    const record = pick(event); if (!record || record.entity.selectable === false) return;
    clearTimeout(state.selectTimer);
    if (!event.detail) state.callbacks.onSelect?.(record.entity.ref);
    else if (event.detail === 1) {
      state.selectRef = record.entity.ref;
      state.selectTimer = setTimeout(() => { state.selectRef = ""; state.callbacks.onSelect?.(record.entity.ref); }, 320);
    }
  });
  listen("dblclick", event => { const r = pick(event); if (r) { event.stopPropagation(); clearTimeout(state.selectTimer); state.callbacks.onInspect?.(r.entity.ref); } });
  listen("contextmenu", event => { event.preventDefault(); event.stopPropagation(); if (!state.suppressContext) { const r = pick(event); if (r) state.callbacks.onTarget?.(r.entity.ref); } });
  listen("pointerdown", event => {
    if (![0, 1, 2].includes(event.button) || (event.button !== 2 && event.target.closest("button"))) return;
    event.preventDefault(); event.stopPropagation(); root.focus({ preventScroll: true });
    state.dragged = false; state.suppressContext = false;
    state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...state.cameraState }, pan: event.shiftKey || event.button !== 0, right: event.button === 2, record: pick(event) };
    root.setPointerCapture(event.pointerId);
  });
  listen("pointermove", event => {
    const drag = state.drag;
    if (!drag) { hover(pick(event)); return; }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) < 4 && !state.dragged) return; state.dragged = true;
    const c = state.cameraState;
    if (drag.pan) {
      Object.assign(c, panCamera(drag.camera, dx, dy, root.clientHeight));
    } else { c.yaw = drag.camera.yaw - dx * 0.006; c.elevation = clamp(drag.camera.elevation + dy * 0.004, 0.48, 1.3); }
    requestDraw();
  });
  const endDrag = event => {
    const drag = state.drag; state.drag = null;
    if (drag && root.hasPointerCapture(drag.id)) root.releasePointerCapture(drag.id);
    if (drag?.right) { state.suppressContext = true; if (!state.dragged && event.type === "pointerup" && drag.record) state.callbacks.onTarget?.(drag.record.entity.ref); }
  };
  listen("pointerup", endDrag); listen("pointercancel", endDrag); listen("lostpointercapture", endDrag);
  listen("pointerleave", () => { if (!state.drag) hover(null); });
  listen("focusin", event => { const r = pick(event); if (r) hover(r); });
  listen("wheel", event => { event.preventDefault(); event.stopPropagation(); state.cameraState.zoom = clamp(state.cameraState.zoom * Math.exp(-clamp(event.deltaY, -160, 160) * 0.002), 0.35, 2.5); requestDraw(); }, { passive: false });
  listen("keydown", event => {
    if (event.target.closest("input,textarea,select,[contenteditable]")) return;
    if (event.code === "KeyT" && state.records.some(r => r.entity.ref === app.hovered)) { event.preventDefault(); event.stopPropagation(); state.callbacks.onTarget?.(app.hovered); return; }
    const delta = { ArrowLeft: [-32, 0], ArrowRight: [32, 0], ArrowUp: [0, -32], ArrowDown: [0, 32] }[event.key];
    if (delta) { event.preventDefault(); event.stopPropagation(); Object.assign(state.cameraState, panCamera(state.cameraState, ...delta, root.clientHeight)); requestDraw(); }
  });
  state.observer = new ResizeObserver(requestDraw); state.observer.observe(root);
  function update(data, options) {
    state.callbacks = options; state.labelsText = { ...defaults, ...options.labels };
    if (state.archId !== data.archId) {
      clearTimeout(state.selectTimer); state.selectRef = "";
      state.archId = data.archId;
      state.facings.clear();
      effects.clear(); state.attackAnchors = []; state.attacks.clear();
      const focus = (data.nodes || []).find(n => !n.isFog && (n.participants || []).some(e => e.isMine || e.selected)) || data.nodes?.[0];
      const layout = layoutArchitecture(data.nodes || []), floor = layout.find(f => f.node === focus) || layout[0];
      const left = floor ? Math.min(floor.x - floor.width / 2, ...floor.entities.filter(e => e.pedestal).map(e => e.x - 2)) : -10;
      const right = floor ? floor.x + floor.width / 2 : 10;
      const width = right - left, depth = floor?.depth || 11, aspect = Math.max(0.5, root.clientWidth / Math.max(1, root.clientHeight));
      const horizontal = width * Math.cos(0.18) + depth * Math.sin(0.18);
      const vertical = width * Math.sin(0.18) * Math.sin(0.75) + depth * Math.cos(0.18) * Math.sin(0.75) + 6;
      const zoom = Math.min(1, 26 / Math.max(vertical + 1.5, (horizontal + 6) / aspect));
      state.entryCamera = { x: (left + right) / 2, y: (floor?.y || 0) + 2, z: floor?.z || 0, zoom: clamp(zoom, 0.35, 1), yaw: 0.18, elevation: 0.75 };
      if (!cameraRecords.has(data.archId)) cameraRecords.set(data.archId, { ...state.entryCamera });
      state.cameraState = cameraRecords.get(data.archId);
    }
    state.vm = data; root.dataset.archId = data.archId || ""; root.dataset.renderer = "webgl";
    toolbar.replaceChildren();
    for (const [key, label, icon] of [["reset", "reset", state.labelsText.reset], ["left", "orbitLeft", "↶"], ["right", "orbitRight", "↷"], ["out", "zoomOut", "−"], ["in", "zoomIn", "+"]]) {
      const button = make("button", "", icon); button.type = "button"; button.dataset.camera = key; button.title = state.labelsText[label]; toolbar.append(button);
    }
    help.textContent = state.labelsText.help; rebuild(data); requestDraw();
  }
  update(vm, callbacks);
  return {
    playAttack(event) {
      if (event.archId !== state.archId || typeof event.hit !== "boolean" || !event.id || state.attacks.has(event.id)
        || motion?.matches) return false;
      const source = state.records.find(r => r.entity.ref === event.sourceRef) || state.records.find(r => r.entity.ref === event.ownerRef);
      const target = state.records.find(r => r.entity.ref === event.targetRef);
      if (!source || !target || source.floor !== target.floor || source.entity.derezzed || target.entity.derezzed) return false;
      const visual = entityVisual(event.visual ? { visual: event.visual } : source.entity.ref === event.sourceRef ? source.entity : {});
      if (visual.animation === "none") return false;
      const owner = state.records.find(r => r.entity.ref === event.ownerRef);
      for (const record of new Set([source, owner].filter(Boolean))) {
        record.yaw = facingYaw(record, target, record.yaw); state.facings.set(record.entity.ref, record.yaw);
        quaternion.setFromAxisAngle(up, record.yaw);
        matrix.compose(new THREE.Vector3(record.x, record.y, record.z), quaternion, new THREE.Vector3(record.scale, record.scale, record.scale));
        for (const mesh of [record.mesh, record.wire]) { mesh.setMatrixAt(record.instance, matrix); mesh.instanceMatrix.needsUpdate = true; }
      }
      const center = record => new THREE.Vector3(record.x, record.y + record.asset.bounds.max.y * record.scale * 0.55, record.z);
      const contact = (record, origin) => {
        const point = center(record), direction = point.clone().sub(origin).normalize();
        raycaster.set(origin, direction);
        const hit = raycaster.intersectObject(record.mesh, false).find(h => h.instanceId === record.instance);
        return hit ? hit.point.clone().addScaledVector(direction, -0.16) : point;
      };
      world.updateMatrixWorld(true);
      const from = contact(source, center(target)), to = contact(target, from);
      const key = visual.animation === "auto" ? entityModelKey({ name: event.programName, visual }, "mini") : visual.animation;
      if (!effects.play({ key, from, to, hit: event.hit, color: visual.color || undefined })) return false;
      state.attacks.add(event.id); if (state.attacks.size > 64) state.attacks.delete(state.attacks.values().next().value);
      for (const r of [owner || source, target]) state.attackAnchors.push({ ref: r.entity.ref, floorId: r.floor.node.floorId });
      requestDraw(); return true;
    },
    attach(nextHost) { if (root.parentElement !== nextHost) nextHost.append(root); requestDraw(); }, update,
    inspect() { return { renderer: "webgl", renders: state.renders, bufferResizes: state.bufferResizes, camera: { ...state.cameraState }, effects: effects.inspect(), drawCalls: renderer.info.render.calls, geometries: renderer.info.memory.geometries,
      models: state.records.map(r => ({ ref: r.entity.ref, key: r.modelKey, x: r.x, y: r.y, z: r.z, yaw: r.yaw, color: r.color,
        screen: projected(r), minY: r.y + r.asset.bounds.min.y * r.scale, surface: r.pedestal ? r.floor.y + 0.3 : r.floor.y, visible: !r.button.hidden })),
      floors: state.floors.map(f => ({ id: f.node.floorId, x: f.x, y: f.y, z: f.z, width: f.width, depth: f.depth })) }; },
    dispose() {
      if (state.disposed) return;
      state.disposed = true; state.abort.abort(); state.observer.disconnect();
      effects.clear();
      if (state.frame !== null) cancelAnimationFrame(state.frame); clearTimeout(state.selectTimer);
      if (app.hovered === state.hoverRef) app.hovered = "";
      clearWorld(); platformGeometry.dispose(); solidMaterial.dispose(); wireMaterial.dispose(); floorMaterial.dispose(); fogMaterial.dispose(); gridMaterial.dispose();
      renderer.dispose(); renderer.forceContextLoss(); root.remove(); releaseModelAssets();
    },
  };
}
