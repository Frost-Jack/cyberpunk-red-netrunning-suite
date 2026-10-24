/* Optional WebGL view. The renderer is loaded only when 3D is opened; all game
 * mutations remain callbacks into the same GM/player actions as the 2D view. */
const records = new WeakMap();
let runtime;
let stylesheet;
function ensureStyle() {
  if (stylesheet) return stylesheet;
  stylesheet = new Promise((resolve, reject) => {
    const link = document.createElement("link"); link.rel = "stylesheet";
    link.href = "/modules/cyberpunk-red-netrunning-suite/styles/architecture-3d.css?webgl=1";
    link.onload = resolve; link.onerror = () => { stylesheet = null; link.remove(); reject(new Error("3D stylesheet unavailable")); };
    document.head.append(link);
  });
  return stylesheet;
}
export function mount3D(app, host, canvasVM, options = {}) {
  if (!host) return Promise.resolve();
  let record = records.get(app);
  if (!record) { record = { cameras: new Map(), generation: 0, view: null }; records.set(app, record); }
  const generation = ++record.generation;
  if (record.view) { record.view.attach(host); record.view.update(canvasVM, options); return Promise.resolve(); }
  host.setAttribute("aria-busy", "true");
  runtime ||= import("../3d/scene.js");
  return Promise.all([runtime, ensureStyle()]).then(([api]) => {
    if (generation !== record.generation || !host.isConnected) return;
    record.view = api.createScene(app, host, canvasVM, options, record.cameras);
    host.removeAttribute("aria-busy");
  }).catch(error => {
    if (generation !== record.generation) return;
    host.removeAttribute("aria-busy");
    const message = document.createElement("p"); message.className = "crns-3d-error";
    message.textContent = options.labels?.unavailable || "3D unavailable. Switch back to 2D.";
    host.replaceChildren(message); console.error("Netrunning Suite | 3D", error);
  });
}
export function dispose3D(app) {
  const record = records.get(app); if (!record) return;
  record.generation++; record.view?.dispose(); record.view = null;
}
export function inspect3D(app) { return records.get(app)?.view?.inspect() || null; }
export function play3DAttack(app, event) { return records.get(app)?.view?.playAttack(event) || false; }
