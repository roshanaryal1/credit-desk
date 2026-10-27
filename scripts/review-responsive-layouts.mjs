/** Read-only geometry regression against a disposable synthetic review server. */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const browserName = process.env.REVIEW_BROWSER || "chromium";
if (!["chromium", "firefox", "webkit"].includes(browserName))
  throw new Error("REVIEW_BROWSER must be chromium, firefox or webkit");
const origin = process.env.REVIEW_URL || "http://127.0.0.1:3100";
if (!process.env.DEMO_PASSWORD) throw new Error("Review password required");
const output = path.join(process.cwd(), "evidence", "responsive", browserName);
await fs.mkdir(output, { recursive: true });
const browser = await engines[browserName].launch({
  headless: true,
  ...(browserName === "chromium" && process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
});
const results = [];
const failures = [];
const runtimeErrors = [];

async function loaded(page, route) {
  const response = await page.goto(origin + route, {
    waitUntil: "networkidle",
  });
  if (
    !response?.ok() ||
    new URL(page.url()).pathname !== new URL(route, origin).pathname
  )
    throw new Error(`Review route did not load: ${route}`);
  await page.locator("h1").first().waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
}

async function bounds(page, label) {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      mainRight: main.getBoundingClientRect().right,
      mainMinWidth: getComputedStyle(main).minWidth,
      masked: [document.documentElement, document.body, main].some((node) =>
        ["hidden", "clip"].includes(getComputedStyle(node).overflowX),
      ),
    };
  });
  results.push({ label, route: new URL(page.url()).pathname, ...geometry });
  if (
    geometry.document > geometry.viewport + 1 ||
    geometry.mainRight > geometry.viewport + 1 ||
    geometry.masked
  ) {
    failures.push({ label, url: page.url(), geometry });
    await page.screenshot({
      path: path.join(output, `overflow-${results.length}.png`),
      fullPage: true,
    });
  }
}

async function scrollRegion(page, name) {
  const region = page.getByRole("region", { name, exact: true });
  await region.scrollIntoViewIfNeeded();
  if ((await region.getAttribute("tabindex")) !== "0")
    throw new Error(`${name} cannot receive keyboard focus`);
  const before = await region.evaluate((node) => ({
    width: node.clientWidth,
    content: node.scrollWidth,
  }));
  await region.focus();
  if (!(await region.evaluate((node) => document.activeElement === node)))
    throw new Error(`${name} did not retain focus`);
  if (before.content > before.width + 1 && browserName === "webkit") {
    // Playwright's WebKit does not keyboard-scroll ANY focused overflow
    // region, including a minimal static page, so this step is unverified
    // there rather than evidence about the application.
    console.log(`${name}: WebKit keyboard scroll not verifiable (engine)`);
  } else if (before.content > before.width + 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll('[role="region"]')].some(
          (node) =>
            node.getAttribute("aria-label") === name && node.scrollLeft > 0,
        ),
      name,
    );
    if ((await page.evaluate(() => scrollX)) !== 0)
      throw new Error(`${name} scrolled the document instead of its table`);
    await region.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    const lastCell = region.locator("tr").last().locator("td,th").last();
    const cell = await lastCell.boundingBox();
    const frame = await region.boundingBox();
    if (!cell || !frame || cell.x + cell.width > frame.x + frame.width + 1)
      throw new Error(`${name} final column cannot be reached`);
    await region.evaluate((node) => {
      node.scrollLeft = 0;
    });
  }
  results.push({ check: "keyboard table scroll", name, ...before });
}

async function keyboardBounds(page) {
  await page.locator('a[href="#main"]').focus();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const node = document.activeElement;
      const box = node.getBoundingClientRect();
      const navigation = node.closest('nav[aria-label="Main"]');
      const clip = navigation?.getBoundingClientRect();
      return {
        text: node.textContent?.trim().slice(0, 60),
        left: box.left,
        right: box.right,
        width: box.width,
        viewport: innerWidth,
        navigation: clip ? { left: clip.left, right: clip.right } : null,
      };
    });
    if (
      focus.width &&
      (focus.left < -1 ||
        focus.right > focus.viewport + 1 ||
        (focus.navigation &&
          (focus.left < focus.navigation.left - 1 ||
            focus.right > focus.navigation.right + 1)))
    )
      throw new Error(
        `Keyboard focus outside viewport: ${JSON.stringify(focus)}`,
      );
  }
  results.push({
    check: "40 keyboard stops remain horizontally visible",
    url: page.url(),
  });
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => {
    if (
      /\.(css|js|woff2?)(\?|$)/.test(response.url()) &&
      response.status() >= 400
    )
      runtimeErrors.push(`Asset ${response.status()}: ${response.url()}`);
  });
  await loaded(page, "/login");
  await page.getByLabel("Your name").fill("Synthetic responsive reviewer");
  await page.getByLabel("Password").fill(process.env.DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  const routes = [
    "/",
    "/queue",
    "/queue/cases",
    "/queue/sla",
    "/clients",
    "/clients/cli_0001",
    "/clients/cli_0001/activity",
    "/clients/cli_0001/collections",
    "/clients/cli_0001/borrowing-base",
    "/clients/cli_0001/source-health",
    "/batches",
    "/watch",
    "/watch/trends",
    "/trust",
    "/audit",
    "/operations/sources",
    "/borrowing-base",
    "/credit-memos",
    "/credit-memos/cli_0001",
    "/about",
    "/trust/evaluation",
    "/trust/replay",
  ];
  await loaded(page, "/batches");
  const batch = await page
    .locator('a[href^="/batches/"]')
    .first()
    .getAttribute("href");
  if (!batch) throw new Error("Seeded batch required for detail regression");
  routes.push(batch);
  await loaded(page, batch);
  const selected = await page
    .locator('a[href*="?invoice="]')
    .first()
    .getAttribute("href");
  if (!selected)
    throw new Error("Seeded invoice required for review-panel regression");
  routes.push(selected);
  for (const width of [320, 360, 390, 412, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await loaded(page, route);
      await bounds(page, `${width}px`);
      if (route === selected) {
        const panel = page.getByRole("complementary", { name: /^Invoice / });
        await panel.waitFor({ state: "visible" });
        if (width >= 1440) {
          const frame = await panel.boundingBox();
          const table = await page
            .getByRole("region", { name: "Batch invoices", exact: true })
            .boundingBox();
          if (
            !frame ||
            !table ||
            frame.x < table.x + table.width - 1 ||
            Math.abs(frame.width - 420) > 1
          )
            throw new Error(
              "Desktop invoice panel lost its separate 420px review column",
            );
        }
      }
    }
    await loaded(page, selected);
    await scrollRegion(page, "Batch invoices");
    if (width === 320 || width === 390) await keyboardBounds(page);
    await page.screenshot({
      path: path.join(output, `selected-invoice-${width}.png`),
      fullPage: true,
    });
    console.log(`Responsive routes checked at ${width}px`);
  }
  for (const viewport of [
    { width: 844, height: 390, label: "landscape" },
    { width: 720, height: 450, label: "200-percent-reflow-equivalent" },
    { width: 320, height: 450, label: "narrow-reflow" },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const route of [
      selected,
      "/trust/evaluation",
      "/clients/cli_0001/collections",
      "/operations/sources",
    ]) {
      await loaded(page, route);
      await bounds(page, viewport.label);
    }
    await loaded(page, "/trust/evaluation");
    await scrollRegion(page, "Check precision and recall");
    await scrollRegion(page, "Agent results by model");
    await keyboardBounds(page);
  }
  await context.close();
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures, runtimeErrors }, null, 2),
  );
}
if (failures.length || runtimeErrors.length)
  throw new Error(
    `Responsive regression: ${failures.length} geometry failures, ${runtimeErrors.length} runtime/asset errors. See ${output}`,
  );
console.log(`Responsive regression passed. Evidence: ${output}`);
