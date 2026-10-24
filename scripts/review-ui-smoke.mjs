/**
 * Disposable synthetic-only review verification. Runs against a locally
 * seeded Next.js server in CI, never a public account or live lender data.
 * Screenshots are build artifacts, not staged as fabricated repository images.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");

const origin = process.env.REVIEW_URL || "http://127.0.0.1:3100";
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error("CI review password required");

const screenshots = path.join(process.cwd(), "evidence", "ui");
await fs.mkdir(screenshots, { recursive: true });

const routes = [
  { route: "/", name: "workbench" },
  { route: "/queue", name: "review-queue" },
  { route: "/queue/cases", name: "synthetic-case-workboard" },
  { route: "/clients", name: "client-directory" },
  { route: "/clients/cli_0001", name: "client-dossier" },
  { route: "/clients/cli_0001/activity", name: "client-activity" },
  { route: "/clients/cli_0001/collections", name: "client-collections" },
  { route: "/clients/cli_0001/borrowing-base", name: "client-collateral" },
  { route: "/batches", name: "invoice-batches" },
  { route: "/watch", name: "risk-monitoring" },
  { route: "/watch/trends", name: "risk-trends" },
  { route: "/trust", name: "trust-panel" },
  { route: "/audit", name: "audit-history" },
  { route: "/borrowing-base", name: "sample-waterfall" },
  { route: "/credit-memos", name: "credit-memo-directory" },
  { route: "/credit-memos/cli_0001", name: "credit-memo-draft" },
];

const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
try {
  for (const [label, viewport, capture] of [
    [
      "desktop",
      { width: 1440, height: 900 },
      new Set(routes.map((r) => r.name)),
    ],
    [
      "mobile",
      { width: 390, height: 844 },
      new Set([
        "workbench",
        "review-queue",
        "client-dossier",
        "client-collateral",
        "credit-memo-draft",
      ]),
    ],
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      isMobile: label === "mobile",
      hasTouch: label === "mobile",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
    const signIn = await page.goto(`${origin}/login?next=%2F`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!signIn?.ok()) throw new Error(`Login page HTTP ${signIn?.status()}`);
    await page.getByLabel("Your name").fill("Synthetic CI reviewer");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(
      (url) => url.origin === origin && url.pathname === "/",
      { timeout: 30_000 },
    );

    for (const item of routes) {
      const response = await page.goto(`${origin}${item.route}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const status = response?.status() ?? 0;
      if (status >= 400 || status === 0) {
        throw new Error(`${label}: ${item.route} responded HTTP ${status}`);
      }
      const heading = page.locator("h1").first();
      await heading.waitFor({ timeout: 15_000 });
      const title = (await heading.textContent())?.trim() ?? "";
      if (
        !title ||
        /application error|not found|internal server error/i.test(title)
      ) {
        throw new Error(`${label}: ${item.route} unexpected heading: ${title}`);
      }
      const html = await page.locator("body").innerText();
      if (
        /Application error: a (client|server)-side exception has occurred/i.test(
          html,
        )
      ) {
        throw new Error(
          `${label}: ${item.route} rendered an application exception`,
        );
      }
      let screenshot = null;
      if (capture.has(item.name)) {
        screenshot = `${item.name}-${label}.png`;
        await page.screenshot({
          path: path.join(screenshots, screenshot),
          fullPage: true,
          animations: "disabled",
        });
      }
      results.push({
        viewport: label,
        route: item.route,
        status,
        heading: title,
        screenshot,
      });
      process.stdout.write(`OK ${label} ${item.route}: ${title}\n`);
    }
    if (label === "desktop") {
      // Browser fetch inherits the signed, HttpOnly session cookie from the
      // same page that has just successfully viewed protected review routes.
      const draft = await page.evaluate(async () => {
        const response = await fetch("/credit-memos/cli_0001/export", {
          credentials: "same-origin",
          redirect: "manual",
        });
        return {
          status: response.status,
          type: response.headers.get("content-type"),
          disposition: response.headers.get("content-disposition"),
          content: await response.text(),
        };
      });
      if (
        draft.status !== 200 ||
        !draft.type?.includes("text/markdown") ||
        !draft.disposition?.includes("attachment") ||
        !draft.content.includes("DRAFT — ANALYST REVIEW REQUIRED") ||
        !draft.content.includes("SYNTHETIC DATA ONLY") ||
        !draft.content.includes("Signed off by: NONE") ||
        !draft.content.includes("facility:cli_0001:") ||
        !draft.content.includes("funding:cli_0001:")
      ) {
        throw new Error(
          "Signed-browser memo export check failed: " +
            JSON.stringify({
              status: draft.status,
              type: draft.type,
              attachment: Boolean(draft.disposition?.includes("attachment")),
              unsigned: draft.content.includes("Signed off by: NONE"),
              facilityRef: draft.content.includes("facility:cli_0001:"),
              fundingRef: draft.content.includes("funding:cli_0001:"),
            }),
        );
      }
      results.push({
        viewport: label,
        route: "/credit-memos/cli_0001/export",
        status: draft.status,
        heading: "Unsigned evidence-bound Markdown export",
        screenshot: null,
      });
    }
    await context.close();
  }

  // Verify self-selected client perspective is read-only and cannot see
  // lender queue/directories even when manually navigating to their URLs.
  const clientContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const clientPage = await clientContext.newPage();
  const clientLogin = await clientPage.goto(origin + "/login", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  if (!clientLogin?.ok()) throw new Error("Client demo sign-in unavailable");
  await clientPage.getByLabel("Explore Credit Desk as").selectOption("CLIENT");
  await clientPage.getByLabel("Your name").fill("Fictional client reviewer");
  await clientPage.getByLabel("Password").fill(password);
  await clientPage.getByRole("button", { name: "Sign in" }).click();
  await clientPage.waitForURL((url) => url.pathname === "/demo/client", {
    timeout: 30_000,
  });
  const title = await clientPage.locator("h1").first().textContent();
  if (!title?.trim()) throw new Error("Client view missing a heading");
  for (const forbidden of [
    "/queue",
    "/clients",
    "/audit",
    "/clients/cli_0002",
    "/credit-memos/cli_0001/export",
  ]) {
    await clientPage.goto(origin + forbidden, {
      waitUntil: "domcontentloaded",
    });
    if (new URL(clientPage.url()).pathname !== "/demo/client") {
      throw new Error(
        "Client perspective accessed forbidden route " + forbidden,
      );
    }
  }
  await clientPage.screenshot({
    path: path.join(screenshots, "fictional-client-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  results.push({
    viewport: "mobile",
    route: "/demo/client",
    status: 200,
    heading: title.trim(),
    screenshot: "fictional-client-mobile.png",
  });
  await clientContext.close();

  // Exercise every public role with no name/password input at desktop size.
  // This CI is seeded with fictional fixtures and explicitly enables public demo.
  if (process.env.PUBLIC_DEMO_ENABLED === "1") {
    const quickRoles = [
      { name: "Employer / lender", home: "/" },
      { name: "Credit analyst", home: "/queue" },
      { name: "Credit checker", home: "/queue" },
      { name: "Client / borrower", home: "/demo/client" },
      { name: "Auditor", home: "/audit" },
    ];
    for (const role of quickRoles) {
      const demoContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const demoPage = await demoContext.newPage();
      demoPage.on("pageerror", (error) =>
        errors.push("quick " + role.name + ": " + error.message),
      );
      await demoPage.goto(origin + "/login", { waitUntil: "domcontentloaded" });
      await demoPage.getByRole("button", {
        name: "Continue as " + role.name + " demo",
      }).click();
      await demoPage.waitForURL(
        (url) => url.origin === origin && url.pathname === role.home,
        { timeout: 30000 },
      );
      const loginCookies = await demoContext.cookies();
      const session = loginCookies.find((c) => c.name === "cd_auth");
      if (!session?.httpOnly) throw new Error("Quick-demo cookie missing HttpOnly flag");
      const body = session.value.split(".")[0];
      const sessionData = JSON.parse(
        Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      );
      if (sessionData.publicDemo !== true) {
        throw new Error("Quick-demo session lacks read-only provenance: " + role.name);
      }
      if (role.name === "Client / borrower") {
        await demoPage.goto(origin + "/queue", { waitUntil: "domcontentloaded" });
        if (new URL(demoPage.url()).pathname !== "/demo/client") {
          throw new Error("Public client reached restricted lender queue");
        }
      }
      if (role.name === "Credit analyst") {
        await demoPage.goto(origin + "/batches", { waitUntil: "domcontentloaded" });
        if (await demoPage.getByRole("button", { name: /Re-run agent/i }).count()) {
          throw new Error("Public analyst has a writable agent control");
        }
      }
      results.push({
        viewport: "desktop",
        route: role.home,
        status: 200,
        heading: "One-click " + role.name + " (read-only)",
        screenshot: null,
      });
      await demoContext.close();
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(screenshots, "results.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );
}
if (errors.length)
  throw new Error(`Browser runtime failures: ${errors.join("; ")}`);
console.log(
  `Verified ${results.length} seeded application routes across desktop/mobile.`,
);
