export function disposeTooltips(app) {
  app._disposeNetTooltips?.();
  app._disposeNetTooltips = null;
}

export function wireTooltips(app, html) {
  disposeTooltips(app);
  const root = html.filter(".crns-root")[0] || html.find(".crns-root")[0];
  if (!root) return;
  const tip = document.createElement("div");
  tip.className = "crns-effect-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  root.appendChild(tip);
  const abort = new AbortController();
  let active = null;
  const show = (ev) => {
    const target = ev.target.closest?.("[data-net-tooltip]");
    if (!target || target === active) return;
    active = target;
    tip.textContent = target.dataset.netTooltip;
    tip.hidden = !tip.textContent;
    if (tip.hidden) return;
    const bounds = root.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const x = Math.max(6, Math.min(bounds.width - tip.offsetWidth - 6, box.left - bounds.left));
    let y = box.bottom - bounds.top + 8;
    if (y + tip.offsetHeight > bounds.height - 6) y = Math.max(6, box.top - bounds.top - tip.offsetHeight - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hide = (ev) => {
    if (active && !active.contains(ev.relatedTarget)) { active = null; tip.hidden = true; }
  };
  root.addEventListener("pointerover", show, { signal: abort.signal });
  root.addEventListener("focusin", show, { signal: abort.signal });
  root.addEventListener("pointerout", hide, { signal: abort.signal });
  root.addEventListener("focusout", hide, { signal: abort.signal });
  app._disposeNetTooltips = () => { abort.abort(); tip.remove(); };
}
