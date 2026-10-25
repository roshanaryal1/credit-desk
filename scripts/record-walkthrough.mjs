/** Record the real fictional-only demo, with captions and no privileged session. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const origin = "https://creditdesk.roshanaryal.com";
const commit = process.env.DEMO_RECORD_COMMIT;
if (!commit || !/^[a-f0-9]{40}$/.test(commit))
  throw new Error(
    "Set DEMO_RECORD_COMMIT to the verified hosted source commit",
  );
const output = path.resolve(
  process.env.WALKTHROUGH_OUTPUT ||
    "docs/walkthrough/creditdesk-2026-10-25.webm",
);
if (path.extname(output) !== ".webm")
  throw new Error("Choose a .webm output path");
try {
  await fs.access(output);
  throw new Error("Recording already exists; choose a new output path");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await fs.mkdir(path.dirname(output), { recursive: true });
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "creditdesk-walkthrough-"),
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const size = { width: 1440, height: 900 };
const context = await browser.newContext({
  viewport: size,
  colorScheme: "light",
  recordVideo: { dir: temporary, size },
});
const page = await context.newPage();
const video = page.video();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function visit(route) {
  const response = await page.goto(origin + route, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  if (!response?.ok()) throw new Error(`Recording route failed: ${route}`);
  await page.locator("h1").first().waitFor();
  if (
    await page
      .locator('main [role="status"]')
      .filter({ hasText: /loading|building|reconciling/i })
      .count()
  )
    throw new Error(`Recording route has not loaded: ${route}`);
  if (errors.length) throw new Error("Recording has a browser runtime error");
}

const scenes = [
  {
    title: "A fictional credit operations desk",
    text: "All records are synthetic. This walkthrough uses a public, read-only account.",
    seconds: 10,
    route: "/login",
  },
  {
    title: "Choose a demo perspective",
    text: "The credit analyst view opens the review queue. Demo roles do not verify real identities.",
    seconds: 10,
    async action() {
      await page.getByRole("button", { name: "Credit analyst" }).click();
      await page.waitForURL((url) => url.pathname === "/queue");
      await page.waitForLoadState("networkidle");
    },
  },
  {
    title: "Overview",
    text: "Start with synthetic exposure, pending reviews and the work that needs attention.",
    seconds: 15,
    route: "/",
  },
  {
    title: "Client relationships",
    text: "Open a fictional borrower and follow the evidence behind its facility position.",
    seconds: 10,
    route: "/clients",
  },
  {
    title: "Client 360",
    text: "Facility headroom, debtor exposure and dated ledger balances are shown together. Headroom is not drawable funding.",
    seconds: 15,
    route: "/clients/cli_0001",
  },
  {
    title: "Evidence and activity",
    text: "The timeline links recorded synthetic events and preserves their business dates.",
    seconds: 10,
    route: "/clients/cli_0001/activity",
  },
  {
    title: "Collections",
    text: "Inspect dated arrears and payment evidence. Historical comparisons respect when invoices became known.",
    seconds: 15,
    route: "/clients/cli_0001/collections",
  },
  {
    title: "Borrowing-base scenario",
    text: "Reconcile the same client's ledger to exclusions and haircuts. These illustrative policy inputs do not authorize lending.",
    seconds: 15,
    route: "/clients/cli_0001/borrowing-base",
  },
  {
    title: "Invoice Check",
    text: "Rules detect issues; cited explanations support review. Stored synthetic decisions remain separate from funding authority.",
    seconds: 20,
    route: "/batches/bat_0007?invoice=inv_0215",
  },
  {
    title: "Portfolio Watch",
    text: "Review synthetic detections and their evidence. Counts describe recorded events, not a risk forecast.",
    seconds: 15,
    route: "/watch",
  },
  {
    title: "Credit assessment draft",
    text: "The memo lists evidence and missing facts. Its Markdown export is unsigned and requires analyst review.",
    seconds: 15,
    route: "/credit-memos/cli_0001",
  },
  {
    title: "Trust Panel",
    text: "Compare decisions with agent recommendations while keeping simulated history and exposed reviews distinct.",
    seconds: 15,
    route: "/trust",
  },
  {
    title: "Frozen decision replay",
    text: "Reopen a stored synthetic decision and verify its checksum. The snapshot preserves what was recorded at decision time.",
    seconds: 15,
    async action() {
      await visit("/trust/replay");
      await page
        .getByRole("link", { name: "inv_0215", exact: true })
        .first()
        .click();
      await page.waitForLoadState("networkidle");
      await page.getByText("Checksum matches", { exact: true }).waitFor();
    },
  },
];

const manifest = {
  recordedAt: new Date().toISOString(),
  origin,
  sourceCommit: commit,
  viewport: size,
  access: "Public fictional credit analyst, read-only",
  audio: "None; captions are added to the recorded browser view",
  plannedSeconds: scenes.reduce((sum, scene) => sum + scene.seconds, 0),
  scenes: [],
};
const started = performance.now();
let complete = false;
try {
  for (const scene of scenes) {
    const began = performance.now();
    if (scene.route) await visit(scene.route);
    else await scene.action();
    await page.evaluate(
      ({ title, text }) => {
        document.querySelector("[data-walkthrough-caption]")?.remove();
        const caption = document.createElement("aside");
        caption.setAttribute("data-walkthrough-caption", "");
        caption.setAttribute("aria-label", "Walkthrough caption");
        caption.style.cssText =
          "position:fixed;bottom:0;left:0;right:0;z-index:2147483646;background:#081e36f2;color:white;padding:16px 24px;font:18px/1.4 Arial,sans-serif;border-top:2px solid #60a5fa;pointer-events:none";
        const heading = document.createElement("strong");
        heading.style.cssText = "display:block;margin-bottom:3px";
        heading.textContent = title;
        const description = document.createElement("span");
        description.textContent = text;
        caption.append(heading, description);
        document.body.append(caption);
      },
      { title: scene.title, text: scene.text },
    );
    const remaining = scene.seconds * 1000 - (performance.now() - began);
    if (remaining > 0) await page.waitForTimeout(remaining);
    if (errors.length) throw new Error("Recording has a browser runtime error");
    manifest.scenes.push({
      title: scene.title,
      caption: scene.text,
      route: new URL(page.url()).pathname + new URL(page.url()).search,
      seconds: scene.seconds,
    });
    console.log("Recorded:", scene.title);
  }
  complete = true;
} finally {
  try {
    await context.close();
    if (complete) {
      await video.saveAs(output);
      manifest.elapsedSeconds = (performance.now() - started) / 1000;
      await fs.writeFile(
        output.replace(/\.webm$/, ".json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );
      console.log("Saved actual browser recording:", output);
    }
  } finally {
    await browser.close();
  }
}
