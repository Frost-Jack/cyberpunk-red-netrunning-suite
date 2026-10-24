/* node tools/help-ui-test.mjs
 * Headless Chrome, actual help VM/listeners/template/CSS and icon-cache module.
 * Compendium indices are fixtures using native CPR SVG assets. Not live Foundry.
 * Requires the bundled Playwright and installed Foundry Handlebars. Screenshots
 * are written to a fresh OS temp directory, not the module release files. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = resolve(root, "../..");
const foundry = "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const require = createRequire(import.meta.url);
const packages = process.env.CRNS_UI_NODE_MODULES || join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(join(packages, "playwright"));
const hbs = require(join(foundry, "node_modules/handlebars"));
const executablePath = [process.env.CRNS_CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && existsSync(p));
assert.ok(executablePath, "Install Chrome/Edge or set CRNS_CHROME_PATH");
const read = (path) => readFileSync(join(root, path), "utf8");
const template = read("templates/help.hbs");
const styles = ["styles/netrunning.css", "styles/help.css"].map(read).join("\n");
const app = { appId: 19, state: {} };
let dictionary = JSON.parse(read("lang/en.json"));
const game = { user: { isGM: true }, i18n: { lang: "en",
  localize: (key) => key.split(".").reduce((value, part) => value?.[part], dictionary) ?? key } };
game.i18n.format = game.i18n.localize;
const context = vm.createContext({ game, console });
function load(path, deps = {}) {
  const source = read(path);
  const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
  return vm.runInContext(`(deps=>{const {${Object.keys(deps)}}=deps;${source.replace(/^import .*;\r?$/gm, "").replace(/\bexport\s+/g, "")};return {${names}};})`, context, { filename: path })(deps);
}
const constants = load("scripts/constants.js"), catalog = load("scripts/reference-catalog.js");
const equipment = load("scripts/equipment.js", catalog);
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const iconDir = "systems/cyberpunk-red-core/icons/compendium/programs";
const icons = new Map(readdirSync(join(dataRoot, iconDir)).map((file) => [normalize(file.replace(/\.svg$/, "")), `${iconDir}/${file}`]));
let indexCalls = 0;
game.packs = [{ collection: "cyberpunk-red-core.core_programs", documentName: "Item", metadata: {}, getIndex: async () => {
  indexCalls++;
  return Object.keys(constants.PROGRAM_INFO).map((name) => {
    const img = icons.get(normalize(name)); assert.ok(img, `Native icon fixture missing for ${name}`);
    return { name, img, type: "program" };
  });
} }];
const iconCache = load("scripts/program-icons.js", constants);
await iconCache.loadProgramIcons();
const { rulesReference } = load("scripts/rules-reference.js");
let compactFixture;
const help = load("scripts/apps/help.js", { ...constants, ...catalog, ...equipment, ...iconCache, rulesReference: (language) => compactFixture || rulesReference(language),
  getWorld: () => ({}), getDeck: () => null, installedPrograms: () => [], userNetrunnerActor: () => null, visibleFloorIds: () => new Set() });
hbs.registerHelper("localize", game.i18n.localize);
const output = mkdtempSync(join(process.env.CRNS_HELP_UI_OUTPUT || tmpdir(), "crns-help-ui-"));
const browser = await chromium.launch({ executablePath, headless: true });
let passed = false;
try {
  const page = await browser.newPage();
  await page.route("http://crns-help.test/**", async (route) => {
    const asset = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
    const path = resolve(dataRoot, asset);
    if (!path.startsWith(dataRoot + sep)) return route.abort();
    const file = existsSync(path) ? path : resolve(foundry, "public", asset);
    if (!existsSync(file)) return route.abort();
    await route.fulfill({ body: readFileSync(file), contentType: { ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" }[extname(file)] });
  });
  const listener = help.activateListeners.toString();
  async function render(language, width) {
    dictionary = JSON.parse(read(`lang/${language}.json`)); game.i18n.lang = language;
    const data = help.getData(app); assert.ok(data.help.rules.length > 0, "Rules reference must not be empty");
    assert.equal(data.help.rulesActive, app.state.helpTab === "rules");
    await page.setViewportSize({ width, height: 800 });
    await page.setContent(`<base href="http://crns-help.test/"><style>body{margin:0}${styles}</style><div class="crns-root theme-green" style="height:100vh"><button data-action="help-open">?</button>${hbs.compile(template)(data)}</div>`);
    await page.evaluate(({ listener, state }) => {
      window.helpApp = { state, render() { throw Error("Search must not re-render the application"); } };
      const html = { find: (selector) => {
        const nodes = [...document.querySelectorAll(selector)];
        nodes.on = (event, handler) => nodes.forEach((node) => node.addEventListener(event, handler));
        return nodes;
      } };
      (0, eval)(`(${listener})`)(window.helpApp, html);
    }, { listener, state: app.state });
    if (await page.locator('.crns-help-overlay').getAttribute('aria-hidden') === 'true') await page.locator('[data-action="help-open"]').click();
    assert.equal(await page.locator('.crns-help-overlay').getAttribute('aria-hidden'), 'false');
    return data.help;
  }
  for (const [language, width] of [["en", 1000], ["ru", 480]]) {
    app.state = { helpTab: "catalog" }; const helpData = await render(language, width);
    const group = page.locator('[data-help-group="program-defenders"]');
    assert.equal(await page.locator('.crns-help-overlay details, .crns-help-overlay summary').count(), 0, "Catalog has no accordion/disclosure markup");
    const total = await page.locator('.crns-help-entry').count();
    assert.ok(total > 40);
    assert.equal(await page.locator('.crns-help-entry:not([hidden])').count(), total, "Every catalog row starts expanded");
    assert.equal(await page.locator('[data-help-group]:not([hidden])').count(), 12, "All continuous categories are present");
    const metrics = await group.evaluate((el) => {
      const effect = el.querySelector(".crns-help-effect");
      return { font: parseFloat(getComputedStyle(effect).fontSize), lineHeight: parseFloat(getComputedStyle(effect).lineHeight),
        hasIconAndCode: [...el.querySelectorAll(".crns-help-entry")].every((row) => row.querySelector("img") && row.querySelector(".crns-help-code")?.textContent.trim()),
        columns: getComputedStyle(el.querySelector(".crns-help-grid")).gridTemplateColumns.split(" ").length,
        overflow: [...el.querySelectorAll(".crns-help-entry")].some((row) => row.scrollWidth > row.clientWidth),
        blur: getComputedStyle(el.closest(".crns-help-overlay")).backdropFilter, animation: getComputedStyle(effect).animationName };
    });
    assert.ok(metrics.font >= 16 && metrics.lineHeight >= 24 && metrics.hasIconAndCode);
    assert.deepEqual([metrics.columns, metrics.overflow, metrics.blur, metrics.animation], [1, false, "none", "none"]);
    await group.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: join(output, `${language}-catalog.png`) });
    const search = page.locator('[data-help-search-input]');
    const clear = page.locator('[data-action="help-search-clear"]');
    assert.equal(await search.getAttribute("placeholder"), helpData.searchPlaceholder);
    assert.equal(helpData.searchLabel, language === "ru" ? "Поиск" : "Search");
    assert.ok(await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16));
    assert.equal(await page.locator('.crns-help-search').evaluate((el) => el.scrollWidth > el.clientWidth), false, "Search toolbar fits desktop and narrow layouts");
    await search.evaluate((el) => { window.originalSearchInput = el; });
    await search.fill(helpData.boosters[0].name);
    assert.equal(await page.locator('[data-help-group="program-boosters"] .crns-help-entry').filter({ hasText: helpData.boosters[0].name }).isVisible(), true, "Localized names are searchable");
    await search.fill("Резервный диск");
    assert.equal(await page.locator('.crns-help-entry:not([hidden])').count(), 1, "Equipment aliases work in both UI languages");
    assert.equal(await page.locator('[data-equipment-key="backupDrive"]').isVisible(), true);
    await search.fill(language === "ru" ? "поджечь" : "cannot ignite");
    assert.equal(await page.locator('[data-equipment-key="insulatedWiring"]').isVisible(), true, "Effects are searchable");
    await search.fill("BACKUPdrive");
    assert.equal(await page.locator('.crns-help-entry:not([hidden])').count(), 1, "Canonical keys match case-insensitively");
    assert.equal(await page.locator('[data-help-heading="program-"]').isVisible(), false, "Empty parent headings are hidden");
    assert.equal(await page.locator('[data-help-group]:not([hidden])').count(), 1, "Empty categories are hidden");
    assert.equal(await search.evaluate((el) => el === window.originalSearchInput && document.activeElement === el), true, "Live filtering preserves input identity and focus");
    assert.equal(await page.evaluate(() => window.helpApp.state.helpQuery), "BACKUPdrive");
    app.state = await page.evaluate(() => window.helpApp.state);
    await render(language, width);
    assert.equal(await search.inputValue(), "BACKUPdrive", "Query survives shell re-render");
    assert.equal(await page.locator('.crns-help-entry:not([hidden])').count(), 1, "Filtering is restored after re-render");
    await search.fill("zzzz-no-such-reference");
    assert.equal(await page.locator('[data-help-panel="catalog"] [data-help-empty]').isVisible(), true);
    assert.equal(await page.locator('[data-help-group]:not([hidden])').count(), 0);
    await clear.click();
    assert.equal(await search.inputValue(), "");
    assert.equal(await search.evaluate((el) => document.activeElement === el), true, "Clear returns focus to search");
    assert.equal(await page.evaluate(() => window.helpApp.state.helpQuery), "");
    assert.equal(await page.locator('.crns-help-entry:not([hidden])').count(), total, "Clear restores the continuous catalog");
    assert.equal(await page.locator('[data-help-panel="catalog"] [data-help-empty]').isVisible(), false);
    await page.locator('[data-help-tab="rules"]').click();
    assert.equal(await page.locator('[data-help-tab="rules"]').getAttribute("aria-selected"), "true");
    assert.ok(await page.locator('[data-help-tab="rules"]').evaluate((el) => parseFloat(getComputedStyle(el).borderBottomWidth) >= 3), "Active tab must have a visible indicator");
    assert.equal(await page.locator('[data-help-panel="catalog"]').isVisible(), false);
    assert.ok(await page.locator('[data-help-panel="rules"] p').count() > 0);
    const scroll = await page.locator('[data-help-panel="rules"]').evaluate((el) => {
      el.scrollTop = 200;
      return { moved: el.scrollTop > 0, overflow: el.scrollWidth > el.clientWidth, font: getComputedStyle(el.querySelector("p")).fontSize };
    });
    assert.deepEqual(scroll, { moved: true, overflow: false, font: "16px" });
    assert.ok(helpData.rules.every((rule) => rule.compact && rule.points.length <= 3), "Production rules use the compact contract");
    const renderedRules = await page.locator('.crns-help-rule').evaluateAll((cards) => cards.map((card) => ({
      id: card.dataset.ruleId,
      summary: card.querySelector('.crns-help-rule-summary')?.textContent,
      diagram: card.querySelector('.crns-help-rule-diagram')?.textContent || null,
      points: [...card.querySelectorAll('.crns-help-rule-points li')].map((node) => node.textContent),
      steps: [...card.querySelectorAll('.crns-help-rule-steps li')].map((node) => node.textContent),
      result: card.querySelector('.crns-help-rule-result')?.textContent,
      headers: [...card.querySelectorAll('th')].map((node) => node.textContent),
      rows: [...card.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((node) => node.textContent)),
      paragraphs: [...card.querySelectorAll(':scope > p')].map((node) => node.textContent),
    })));
    const expectedRules = helpData.rules.map((rule) => ({
      id: rule.id, summary: rule.summary, diagram: rule.diagram || null, points: rule.points, steps: rule.example.steps, result: rule.example.result,
      headers: rule.table?.headers || [], rows: rule.table?.rows || [], paragraphs: [rule.summary],
    }));
    assert.deepEqual(renderedRules, JSON.parse(JSON.stringify(expectedRules)), "All real rules render compact fields without legacy body duplication");
    const realRuleReadability = await page.locator('.crns-help-rules-grid').evaluate((grid) => ({
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      overflow: grid.scrollWidth > grid.clientWidth || [...grid.querySelectorAll('article')].some((card) => card.scrollWidth > card.clientWidth),
      smallText: [...grid.querySelectorAll('p, li, th, td, a, .crns-help-source')].some((node) => parseFloat(getComputedStyle(node).fontSize) < 14.5),
    }));
    assert.deepEqual(realRuleReadability, { columns: width > 900 ? 2 : 1, overflow: false, smallText: false });
    await page.locator('[data-help-panel="rules"]').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: join(output, `${language}-rules-${width}.png`) });
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator('[data-help-tab="catalog"]').getAttribute("aria-selected"), "true");
    assert.equal(await page.locator('.crns-help-entry:not([hidden])').count(), total, "Tabs preserve the continuous catalog");
    await page.keyboard.press("End");
    assert.equal(await page.locator('[data-help-tab="rules"]').getAttribute("aria-selected"), "true");
    await search.fill("zzzz-no-such-rule");
    assert.equal(await page.locator('[data-help-panel="rules"] [data-help-empty]').isVisible(), true);
    const firstRule = helpData.rules[0], tableRule = helpData.rules.find((rule) => rule.table);
    for (const [rule, text] of [
      [firstRule, firstRule.summary], [firstRule, firstRule.points[0]],
      [firstRule, firstRule.example.steps[0]], [firstRule, firstRule.example.result],
      [tableRule, tableRule.table.headers[0]],
    ]) {
      await search.fill(text);
      assert.equal(await page.locator(`[data-rule-id="${rule.id}"]`).isVisible(), true, "Real compact rule fields participate in live search");
    }
    await search.fill(helpData.rules[0].id);
    assert.equal(await page.locator(`[data-rule-id="${helpData.rules[0].id}"]`).isVisible(), true, "Rules match canonical IDs and text");
    await search.fill(helpData.rules[0].title);
    assert.equal(await page.locator(`[data-rule-id="${helpData.rules[0].id}"]`).isVisible(), true);
    app.state = await page.evaluate(() => window.helpApp.state);
    assert.equal(app.state.helpOpen, true);
    await render(language, width);
    assert.equal(await page.locator('[data-help-tab="rules"]').getAttribute("aria-selected"), "true", "Selected tab survives re-render");
    assert.equal(await page.locator('.crns-help-overlay').getAttribute('aria-hidden'), 'false', 'Open reference survives re-render');
    assert.equal(await search.inputValue(), helpData.rules[0].title);
    await search.focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('.crns-help-overlay').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.evaluate(() => window.helpApp.state.helpOpen), false);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), "help-open", "Escape restores opener focus");
    assert.equal(await page.evaluate(() => window.helpApp.state.helpQuery), helpData.rules[0].title, "Escape does not clear the saved query");
    await page.locator('[data-action="help-open"]').click();
    assert.equal(await search.inputValue(), helpData.rules[0].title, "Reopening preserves the query");
    console.log(`OK ${language}: continuous categories, live name/effect/key/alias search, clear/focus/query persistence, rules/tabs/Escape, 16px text, no overflow/blur/motion`);
  }
  compactFixture = [
    { id: "compact-example", title: "Compact example fixture", summary: "Total = 7 + 4", points: ["One short point.", "A second short point."],
      example: { label: "Numeric example", steps: ["Start with 7.", "Add 4: 7 + 4 = 11."], result: "Resultfixture: 11." },
      table: { headers: ["Tierfixture", "Value"], rows: [["First", "7"], ["Second", "4"]] },
      source: "Fixture source", links: [{ title: "Fixture link", url: "https://example.com/reference" }], body: ["LEGACY_BODY_MUST_NOT_RENDER"] },
    { id: "points-only", title: "Points-only fixture", points: ["Pointsfixture without a summary."], source: "Fixture source", body: ["LEGACY_BODY_MUST_NOT_RENDER"] },
    { id: "legacy-fixture", title: "Legacy fixture", body: ["Legacy fallback paragraph."], source: "Fixture source" },
  ];
  for (const width of [1000, 480]) {
    app.state = { helpTab: "rules" };
    await render("en", width);
    assert.equal(await page.locator('.crns-help-rules-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length), width > 900 ? 2 : 1);
    assert.equal(await page.locator('[data-rule-id="compact-example"] .crns-help-rule-steps li').count(), 2);
    assert.equal(await page.locator('[data-rule-id="compact-example"] table tbody tr').count(), 2);
    assert.equal(await page.locator('[data-rule-id="compact-example"] a').getAttribute("href"), "https://example.com/reference");
    assert.equal(await page.locator('.crns-help-rules').getByText("LEGACY_BODY_MUST_NOT_RENDER", { exact: true }).count(), 0, "New fields suppress legacy body paragraphs");
    assert.equal(await page.locator('[data-rule-id="legacy-fixture"]').getByText("Legacy fallback paragraph.", { exact: true }).isVisible(), true);
    const readability = await page.locator('.crns-help-rules-grid').evaluate((el) => ({
      overflow: el.scrollWidth > el.clientWidth || [...el.querySelectorAll("article")].some((card) => card.scrollWidth > card.clientWidth),
      smallText: [...el.querySelectorAll("p, li, th, td, a, .crns-help-source")].some((text) => parseFloat(getComputedStyle(text).fontSize) < 14.5)
    }));
    assert.deepEqual(readability, { overflow: false, smallText: false });
    await page.screenshot({ path: join(output, `compact-rules-${width}.png`) });
    for (const term of ["7 + 4", "Resultfixture", "Tierfixture", "Fixture link"]) {
      await page.locator('[data-help-search-input]').fill(term);
      assert.equal(await page.locator('[data-rule-id="compact-example"]').isVisible(), true, `Compact rule search includes ${term}`);
    }
    await page.locator('[data-help-search-input]').fill("Pointsfixture");
    assert.equal(await page.locator('[data-rule-id="points-only"]').isVisible(), true);
    console.log(`OK compact rules ${width}px: ${width > 900 ? 2 : 1} columns, summary/points/example/table/links, legacy fallback, full-text search, >=14.5px, no overflow`);
  }
  await iconCache.loadProgramIcons(); assert.equal(indexCalls, 1, "Compendium index remains cached");
  console.log(`Screenshots: ${output}`);
  passed = true;
} catch (error) {
  console.error(error.stack || String(error));
  throw error;
} finally {
  // Chrome's shutdown pipe can remain open in the Windows app sandbox.
  setTimeout(() => { console.warn("Chrome shutdown timeout; UI assertions " + (passed ? "passed" : "incomplete")); process.exit(passed ? 0 : 1); }, 3000).unref();
  await browser.close();
}
