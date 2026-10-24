/* Foundry can retain a package manifest until restart. New view styles must
 * also load when the server still knows only the original netrunning.css. */
export async function ensureSuiteStyles() {
  await Promise.all(["architecture-3d", "help"].map(name => new Promise(resolve => {
    const path = `modules/cyberpunk-red-netrunning-suite/styles/${name}.css`;
    if (Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith(path))) { resolve(); return; }
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(link => link.href.endsWith(path));
    const link = existing || document.createElement("link");
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", () => { console.error(`Netrunning Suite | Failed to load ${path}`); resolve(); }, { once: true });
    if (!existing) { link.rel = "stylesheet"; link.href = path; document.head.append(link); }
  })));
}
