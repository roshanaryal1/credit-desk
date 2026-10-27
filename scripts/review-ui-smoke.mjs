/**
 * Disposable synthetic-only review verification. Runs against a locally
 * seeded Next.js server in CI, never a public account or live lender data.
 * Screenshots are build artifacts, not staged as fabricated repository images.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

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
  { route: "/queue/sla", name: "synthetic-case-sla" },
  { route: "/clients", name: "client-directory" },
  { route: "/clients/cli_0001", name: "client-dossier" },
  { route: "/clients/cli_0001/activity", name: "client-activity" },
  { route: "/clients/cli_0001/collections", name: "client-collections" },
  { route: "/clients/cli_0001/borrowing-base", name: "client-collateral" },
  { route: "/clients/cli_0001/source-health", name: "source-health" },
  { route: "/batches", name: "invoice-batches" },
  { route: "/watch", name: "risk-monitoring" },
  { route: "/watch/trends", name: "risk-trends" },
  { route: "/trust", name: "trust-panel" },
  { route: "/audit", name: "audit-history" },
  { route: "/operations/sources", name: "synthetic-ingestion-operations" },
  { route: "/borrowing-base", name: "sample-waterfall" },
  { route: "/credit-memos", name: "credit-memo-directory" },
  { route: "/credit-memos/cli_0001", name: "credit-memo-draft" },
];

const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
const behaviorChecks = [];

async function downloadText(page, route) {
  return page.evaluate(async (route) => {
    const response = await fetch(route, {
      credentials: "same-origin",
      redirect: "manual",
    });
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      disposition: response.headers.get("content-disposition"),
      cache: response.headers.get("cache-control"),
      nosniff: response.headers.get("x-content-type-options"),
      digest: response.headers.get("x-portfolio-digest"),
      content: await response.text(),
    };
  }, route);
}

function checkPortfolioDownload(file) {
  const footer = file.content.match(
    /SHA-256 of the preceding Markdown body: ([a-f0-9]{64})\n$/,
  );
  const body = footer ? file.content.slice(0, footer.index) : "";
  const digest = createHash("sha256").update(body).digest("hex");
  if (
    file.status !== 200 ||
    !file.type?.includes("text/markdown") ||
    !file.disposition?.includes("attachment") ||
    !file.cache?.includes("private") ||
    !file.cache.includes("no-store") ||
    file.nosniff !== "nosniff" ||
    !footer ||
    footer[1] !== digest ||
    file.digest !== digest ||
    !file.content.includes("FICTIONAL DATA / REVIEW ONLY") ||
    !file.content.includes("NOT drawable availability")
  )
    throw new Error(
      "Portfolio attachment, privacy or content-digest check failed",
    );
}

async function exitDemoAccount(page, context, intent) {
  // A browser-only fixture proves both cookie names are removed even for
  // read-only public accounts, which cannot set review mode themselves.
  await context.addCookies([
    {
      name: "cd_mode",
      value: "ASSIST",
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
      secure: origin.startsWith("https:"),
    },
  ]);
  const label = intent === "switch" ? "Switch role" : "Sign out";
  const button = page.getByRole("button", { name: label, exact: true });
  await button.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(
    (url) =>
      url.pathname === "/login" &&
      url.hash === (intent === "switch" ? "#quick-demo-title" : ""),
  );
  await waitForRenderedContent(page);
  if (
    (await context.cookies()).some((cookie) =>
      ["cd_auth", "cd_mode"].includes(cookie.name),
    )
  ) {
    throw new Error(label + " did not clear both browser session cookies");
  }
  if (
    await page
      .getByRole("region", { name: "Current demo account", exact: true })
      .count()
  ) {
    throw new Error("Signed-out login still exposes an active account card");
  }
}

async function requireSignedOutRoute(page) {
  await page.goto(origin + "/clients", { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname !== "/login") {
    throw new Error(
      "Protected route remained accessible after browser sign-out",
    );
  }
  await waitForRenderedContent(page);
}

async function checkEvidenceAndScenario(page, label) {
  await page.goto(origin + "/queue/cases", { waitUntil: "domcontentloaded" });
  await waitForRenderedContent(page);
  const checklist = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Evidence checklist" }) })
    .first();
  const summary = checklist.locator("summary");
  const statedCount = Number(
    (await summary.innerText()).match(/\((\d+)\)/)?.[1],
  );
  await summary.click();
  if (!(await checklist.evaluate((element) => element.open))) {
    throw new Error("Case evidence details did not expand");
  }
  const visibleRows = await checklist.locator("li").allTextContents();
  if (
    !statedCount ||
    visibleRows.length !== statedCount ||
    !visibleRows.some((text) => text.includes("MISSING"))
  ) {
    throw new Error(
      "Case evidence details did not reveal their stated outstanding requirements",
    );
  }
  await page.goto(origin + "/credit-memos/cli_0001", {
    waitUntil: "domcontentloaded",
  });
  await waitForRenderedContent(page);
  const memoChecklist = page.locator(
    'section[aria-labelledby="checklist-heading"]',
  );
  if (
    !(await memoChecklist.locator("li").count()) ||
    !(await memoChecklist.innerText()).includes("MISSING")
  ) {
    throw new Error("Memo did not show the seeded outstanding case evidence");
  }

  const route = "/clients/cli_0001/borrowing-base";
  await page.goto(origin + route, { waitUntil: "domcontentloaded" });
  await waitForRenderedContent(page);
  const advance = page.getByLabel("Advance rate (bps)", { exact: true });
  const baselineAdvance = await advance.inputValue();
  const sourceRows = await page
    .getByRole("region", {
      name: "Source-backed invoice treatment",
      exact: true,
    })
    .last()
    .locator("tbody tr")
    .allTextContents();
  if (!sourceRows.length)
    throw new Error("Scenario test has no seeded invoice evidence");
  await advance.fill("0");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.waitForURL(
    (url) => url.searchParams.get("advanceRateBps") === "0",
  );
  await waitForRenderedContent(page);
  const comparison = page.getByRole("region", {
    name: "Scenario waterfall comparison",
    exact: true,
  });
  await comparison.waitFor({ state: "visible" });
  const grossAdvance = comparison
    .locator("tbody tr")
    .filter({ has: page.getByRole("rowheader", { name: /^gross advance$/i }) });
  const cells = await grossAdvance.getByRole("cell").allTextContents();
  const numeric = (value) => Number(value.replace(/[^0-9.-]/g, ""));
  if (cells.length !== 3 || numeric(cells[0]) <= 0 || numeric(cells[1]) !== 0) {
    throw new Error(
      "Zero advance-rate comparison did not reduce the scenario advance while preserving a nonzero baseline",
    );
  }
  const after = await page
    .getByRole("region", {
      name: "Source-backed invoice treatment",
      exact: true,
    })
    .last()
    .locator("tbody tr")
    .allTextContents();
  if (JSON.stringify(after) !== JSON.stringify(sourceRows))
    throw new Error("Scenario comparison altered baseline invoice facts");
  await comparison.screenshot({
    path: path.join(screenshots, `scenario-comparison-${label}.png`),
    animations: "disabled",
  });
  // The boundary accepts every safe integer cent amount. Display must retain
  // the last cent even where floating-point dollars would round it away.
  const maximum = new URL(page.url());
  maximum.searchParams.set("reservesCents", "9007199254740991");
  await page.goto(maximum.toString(), { waitUntil: "domcontentloaded" });
  await waitForRenderedContent(page);
  const reserveCells = await comparison
    .locator("tbody tr")
    .filter({ has: page.getByRole("rowheader", { name: /^reserves$/i }) })
    .getByRole("cell")
    .allTextContents();
  if (reserveCells[1] !== "$90,071,992,547,409.91") {
    throw new Error("Maximum safe integer scenario lost a cent in display");
  }
  const submitted = new URL(page.url());
  submitted.searchParams.set("advanceRateBps", "10001");
  await page.goto(submitted.toString(), { waitUntil: "domcontentloaded" });
  await waitForRenderedContent(page);
  if (
    !(await page.locator("#scenario-errors").innerText()).includes(
      "Invalid scenario",
    ) ||
    (await page
      .getByRole("region", {
        name: "Scenario waterfall comparison",
        exact: true,
      })
      .count())
  ) {
    throw new Error(
      "Invalid scenario input was not rejected at the server boundary",
    );
  }
  await page
    .getByRole("link", { name: "Reset to baseline", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === route && !url.search);
  await waitForRenderedContent(page);
  if (
    (await advance.inputValue()) !== baselineAdvance ||
    (await page
      .getByRole("region", {
        name: "Scenario waterfall comparison",
        exact: true,
      })
      .count())
  ) {
    throw new Error("Reset did not restore the original baseline scenario");
  }
  behaviorChecks.push({
    viewport: label,
    check:
      "Case and memo checklist; zero-rate comparison, exact maximum cents, unchanged source facts, invalid input and reset",
    result: "PASS",
  });
}

async function checkDateFilters(page, label) {
  await page.goto(origin + "/watch");
  await waitForRenderedContent(page);
  const input = page.getByLabel("Go to date", { exact: true });
  const today = await input.inputValue();
  const start = await input.getAttribute("min");
  const baseline = await page.locator("main").innerText();
  for (const query of [
    "asOf=2026-99-99",
    "asOf=2026-00-00",
    "asOf=2026-09-99",
    "asOf=2026-09-31",
    "asOf=2026-02-29",
    "asOf=invalid",
    "asOf=",
    "asOf=2026-07-22&asOf=2026-10-19",
  ]) {
    await page.goto(origin + "/watch?" + query);
    await waitForRenderedContent(page);
    if (
      (await input.inputValue()) !== today ||
      (await page.locator("main").innerText()) !== baseline
    )
      throw new Error(
        `${label}: invalid Watch date changed the fallback content: ${query}`,
      );
  }
  for (const [value, expected] of [
    ["2024-02-29", start],
    [start, start],
    [today, today],
    ["9999-12-31", today],
  ]) {
    await page.goto(origin + "/watch?asOf=" + value);
    await waitForRenderedContent(page);
    if ((await input.inputValue()) !== expected)
      throw new Error(
        `${label}: valid Watch date lost its range clamp: ${value}`,
      );
    await page
      .getByRole("navigation", { name: "Move through the history" })
      .waitFor({ state: "visible" });
  }
  const activity = "/clients/cli_0001/activity";
  await page.goto(origin + activity);
  await waitForRenderedContent(page);
  const activityBaseline = await page.locator("main").innerText();
  for (const query of [
    "asOf=2026-09-99",
    "asOf=2026-00-00",
    "asOf=2026-07-22&asOf=2026-10-19",
  ]) {
    await page.goto(origin + activity + "?" + query);
    await waitForRenderedContent(page);
    if (
      (await page
        .getByLabel("Business as of", { exact: true })
        .inputValue()) !== today ||
      (await page.locator("main").innerText()) !== activityBaseline
    )
      throw new Error(
        `${label}: activity date fallback changed or rendered an error: ${query}`,
      );
  }
  behaviorChecks.push({
    viewport: label,
    check:
      "Watch malformed and repeated dates preserve fallback content; valid dates retain clamps; activity malformed dates remain safe",
    result: "PASS",
  });
}

function observeBrowser(page, label) {
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  const requiredAsset = (request) =>
    ["stylesheet", "script", "font"].includes(request.resourceType());
  page.on("response", (response) => {
    if (requiredAsset(response.request()) && response.status() >= 400) {
      errors.push(
        `${label}: asset HTTP ${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
  });
  page.on("requestfailed", (request) => {
    if (requiredAsset(request)) {
      errors.push(`${label}: asset failed ${new URL(request.url()).pathname}`);
    }
  });
}

async function waitForRenderedContent(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const styled = getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim();
      const loading = [
        ...document.querySelectorAll('main [role="status"]'),
      ].some((element) =>
        /loading|building|reconciling/i.test(element.textContent ?? ""),
      );
      return Boolean(styled) && !loading;
    },
    undefined,
    { timeout: 30_000 },
  );
  // Root variables alone can exist when the Tailwind utility transform
  // is missing. Require the workspace shell utilities to be applied too.
  const utilities = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return body.display === "flex" && body.flexDirection === "column";
  });
  if (!utilities)
    throw new Error("Required Tailwind shell styles are not applied");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  if (errors.length) {
    throw new Error(`Browser runtime or asset failures: ${errors.join("; ")}`);
  }
}

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
        "source-health",
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
    observeBrowser(page, label);
    const signIn = await page.goto(`${origin}/login?next=%2F`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!signIn?.ok()) throw new Error(`Login page HTTP ${signIn?.status()}`);
    await waitForRenderedContent(page);
    await page.screenshot({
      path: path.join(screenshots, `login-${label}.png`),
      fullPage: true,
      animations: "disabled",
    });
    results.push({
      viewport: label,
      route: "/login",
      status: signIn.status(),
      heading: (await page.locator("h1").first().textContent())?.trim(),
      screenshot: `login-${label}.png`,
    });
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
      await waitForRenderedContent(page);
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
    await checkDateFilters(page, label);
    await checkEvidenceAndScenario(page, label);
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
        !draft.content.includes("funding:cli_0001:") ||
        !draft.content.includes("Case evidence requirements") ||
        !draft.content.includes("FICTIONAL METADATA") ||
        !draft.content.includes("MISSING") ||
        !draft.content.replaceAll("\\_", "_").includes(":BANK_CONFIRMATION")
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
      const portfolio = await downloadText(page, "/portfolio/export");
      checkPortfolioDownload(portfolio);
      const repeat = await downloadText(page, "/portfolio/export");
      checkPortfolioDownload(repeat);
      if (
        portfolio.content !== repeat.content ||
        !portfolio.content.includes("/clients/cli_0002")
      ) {
        throw new Error(
          "Portfolio export is not repeatable or has no multi-client fixture",
        );
      }
      const scoped = await downloadText(
        page,
        "/portfolio/export?client=cli_0001",
      );
      checkPortfolioDownload(scoped);
      if (
        !scoped.content.includes("- Client count: 1\n") ||
        !scoped.content.includes("/clients/cli_0001") ||
        scoped.content.includes("/clients/cli_0002")
      ) {
        throw new Error(
          "Client-scoped portfolio export contains the wrong relationships",
        );
      }
      const invalidDate = await downloadText(
        page,
        "/portfolio/export?asOf=2026-02-30",
      );
      const missingClient = await downloadText(
        page,
        "/portfolio/export?client=missing-synthetic-client",
      );
      if (invalidDate.status !== 400 || missingClient.status !== 404) {
        throw new Error(
          "Portfolio export did not reject invalid dates or unknown clients",
        );
      }
      behaviorChecks.push({
        viewport: label,
        check:
          "Memo checklist export; private deterministic portfolio digest, client filter and invalid scope",
        result: "PASS",
      });
      await exitDemoAccount(page, context, "signout");
      await requireSignedOutRoute(page);
      behaviorChecks.push({
        viewport: label,
        check:
          "Password reviewer keyboard sign-out clears cookies and protects fresh navigation",
        result: "PASS",
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
  observeBrowser(clientPage, "client");
  const clientLogin = await clientPage.goto(origin + "/login", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  if (!clientLogin?.ok()) throw new Error("Client demo sign-in unavailable");
  await waitForRenderedContent(clientPage);
  await clientPage.getByLabel("Role", { exact: true }).selectOption("CLIENT");
  await clientPage.getByLabel("Your name").fill("Fictional client reviewer");
  await clientPage.getByLabel("Password").fill(password);
  await clientPage.getByRole("button", { name: "Sign in" }).click();
  await clientPage.waitForURL((url) => url.pathname === "/demo/client", {
    timeout: 30_000,
  });
  await waitForRenderedContent(clientPage);
  const title = await clientPage.locator("h1").first().textContent();
  if (!title?.trim()) throw new Error("Client view missing a heading");
  const borrowerChecklist = clientPage.locator("section").filter({
    has: clientPage.getByRole("heading", {
      name: "Outstanding fictional evidence",
      exact: true,
    }),
  });
  const outstanding = await borrowerChecklist.locator("li").allInnerTexts();
  if (
    !outstanding.length ||
    outstanding.some(
      (text) =>
        !/\b(MISSING|EXPIRED)\b/.test(text) ||
        /\b(RECEIVED|NOT_REQUIRED)\b/.test(text),
    )
  ) {
    throw new Error(
      "Borrower checklist does not contain only outstanding fictional evidence",
    );
  }
  for (const forbidden of [
    "/queue",
    "/clients",
    "/audit",
    "/clients/cli_0002",
    "/credit-memos/cli_0001/export",
    "/operations/sources",
    "/queue/sla",
    "/portfolio/export",
  ]) {
    await clientPage.goto(origin + forbidden, {
      waitUntil: "domcontentloaded",
    });
    if (new URL(clientPage.url()).pathname !== "/demo/client") {
      throw new Error(
        "Client perspective accessed forbidden route " + forbidden,
      );
    }
    await waitForRenderedContent(clientPage);
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
  behaviorChecks.push({
    viewport: "mobile",
    check:
      "Borrower outstanding checklist and direct staff/export route denials",
    result: "PASS",
  });

  // Exercise every public role at both breakpoints. Each row signs in twice
  // (initial role, then a different role), totaling 20 quick logins, below
  // the per-IP limit of 30 in a fresh disposable browser-test database.
  // This CI is seeded with fictional fixtures and explicitly enables public demo.
  if (process.env.PUBLIC_DEMO_ENABLED === "1") {
    const quickRoles = [
      { name: "Employer / lender", home: "/" },
      { name: "Credit analyst", home: "/queue" },
      { name: "Credit checker", home: "/queue" },
      { name: "Client / borrower", home: "/demo/client" },
      { name: "Auditor", home: "/audit" },
    ];
    let publicSignIns = 0;
    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
    ]) {
      for (const [roleIndex, role] of quickRoles.entries()) {
        const demoContext = await browser.newContext({
          viewport: { width, height },
          isMobile: label === "mobile",
          hasTouch: label === "mobile",
        });
        const demoPage = await demoContext.newPage();
        observeBrowser(demoPage, "quick " + role.name);
        await demoPage.goto(origin + "/login", {
          waitUntil: "domcontentloaded",
        });
        await waitForRenderedContent(demoPage);
        await demoPage
          .getByRole("button", {
            name: role.name,
          })
          .click();
        publicSignIns++;
        await demoPage.waitForURL(
          (url) => url.origin === origin && url.pathname === role.home,
          { timeout: 30000 },
        );
        await waitForRenderedContent(demoPage);
        const loginCookies = await demoContext.cookies();
        const session = loginCookies.find((c) => c.name === "cd_auth");
        if (!session?.httpOnly)
          throw new Error("Quick-demo cookie missing HttpOnly flag");
        const body = session.value.split(".")[0];
        const sessionData = JSON.parse(
          Buffer.from(
            body.replace(/-/g, "+").replace(/_/g, "/"),
            "base64",
          ).toString("utf8"),
        );
        if (sessionData.publicDemo !== true) {
          throw new Error(
            "Quick-demo session lacks public-demo provenance: " + role.name,
          );
        }
        if (role.name === "Client / borrower") {
          for (const forbidden of [
            "/queue",
            "/queue/sla",
            "/operations/sources",
            "/portfolio/export",
          ]) {
            await demoPage.goto(origin + forbidden, {
              waitUntil: "domcontentloaded",
            });
            if (new URL(demoPage.url()).pathname !== "/demo/client") {
              throw new Error(
                "Public client reached restricted staff route: " + forbidden,
              );
            }
            await waitForRenderedContent(demoPage);
          }
        } else {
          const pack = await downloadText(
            demoPage,
            "/portfolio/export?client=cli_0001",
          );
          checkPortfolioDownload(pack);
          behaviorChecks.push({
            viewport: label,
            check:
              role.name + " can download a fictional read-only review pack",
            result: "PASS",
          });
        }
        if (role.name === "Credit analyst") {
          await demoPage.goto(origin + "/batches", {
            waitUntil: "domcontentloaded",
          });
          await waitForRenderedContent(demoPage);
          const batchPath = await demoPage
            .locator('a[href^="/batches/"]')
            .first()
            .getAttribute("href");
          if (!batchPath)
            throw new Error("Public analyst has no seeded batch to inspect");
          await demoPage.goto(origin + batchPath, {
            waitUntil: "domcontentloaded",
          });
          await waitForRenderedContent(demoPage);
          const invoicePath = await demoPage
            .locator('a[href*="?invoice="]')
            .first()
            .getAttribute("href");
          if (!invoicePath)
            throw new Error("Seeded batch contains no invoice evidence");
          await demoPage.goto(origin + invoicePath, {
            waitUntil: "domcontentloaded",
          });
          await waitForRenderedContent(demoPage);
          // The one-click analyst has the analyst's synthetic write surface:
          // the decision form, reached in shadow mode, with no AI view first.
          await demoPage
            .getByRole("button", { name: "Save decision" })
            .waitFor({ timeout: 30000 });
          if (
            !(await demoPage.getByText("Shadow mode", { exact: false }).count())
          )
            throw new Error(
              "Public analyst decision form is not in shadow mode",
            );
          behaviorChecks.push({
            viewport: label,
            check: "One-click analyst can reach the shadow-mode decision form",
            result: "PASS",
          });
        }
        const account = demoPage.getByRole("region", {
          name: "Current demo account",
          exact: true,
        });
        await account.getByText(role.name, { exact: true }).waitFor();
        const bounds = await account.boundingBox();
        if (!bounds || bounds.y < -1 || bounds.y + bounds.height > height + 1) {
          throw new Error(
            "Account exit controls are not visible near the workspace logo: " +
              role.name,
          );
        }
        await account.screenshot({
          path: path.join(
            screenshots,
            "account-" + roleIndex + "-" + label + ".png",
          ),
          animations: "disabled",
        });
        await exitDemoAccount(demoPage, demoContext, "switch");
        const chooser = demoPage.getByRole("heading", {
          name: "Explore the demo",
          exact: true,
        });
        const chooserBounds = await chooser.boundingBox();
        if (
          !chooserBounds ||
          chooserBounds.y < -1 ||
          chooserBounds.y >= height
        ) {
          throw new Error("Switch role did not reveal the demo chooser");
        }
        const nextRole = quickRoles[(roleIndex + 1) % quickRoles.length];
        await demoPage.getByRole("button", { name: nextRole.name }).click();
        publicSignIns++;
        await demoPage.waitForURL((url) => url.pathname === nextRole.home);
        await waitForRenderedContent(demoPage);
        await demoPage
          .getByRole("region", { name: "Current demo account", exact: true })
          .getByText(nextRole.name, { exact: true })
          .waitFor();
        const replacement = (await demoContext.cookies()).find(
          (cookie) => cookie.name === "cd_auth",
        );
        const replacementData =
          replacement &&
          JSON.parse(
            Buffer.from(replacement.value.split(".")[0], "base64url").toString(
              "utf8",
            ),
          );
        if (
          !replacementData ||
          replacementData.publicDemo !== true ||
          replacementData.persona === sessionData.persona ||
          replacementData.sid === sessionData.sid
        ) {
          throw new Error(
            "Switch role reused the previous identity or lost read-only session provenance",
          );
        }
        await exitDemoAccount(demoPage, demoContext, "signout");
        await requireSignedOutRoute(demoPage);
        behaviorChecks.push({
          viewport: label,
          check:
            role.name +
            " keyboard switch, different-role login and sign-out clear cookies and deny protected navigation",
          result: "PASS",
        });
        results.push({
          viewport: label,
          route: role.home,
          status: 200,
          heading: "One-click " + role.name + " (read-only)",
          screenshot: null,
        });
        await demoContext.close();
      }
    }
    if (publicSignIns !== 20 || publicSignIns >= 30) {
      throw new Error(
        "Unexpected quick-login budget in the disposable smoke test",
      );
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(screenshots, "results.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        results,
        errors,
        behaviorChecks,
      },
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
