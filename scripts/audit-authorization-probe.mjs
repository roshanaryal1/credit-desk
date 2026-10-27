/**
 * Independent authorization and session probe for the enterprise audit (#180).
 * Runs only against a disposable, locally seeded production-mode server with
 * synthetic data. It signs test tokens with that server's throwaway secret,
 * so it never targets a hosted deployment. Complements review-ui-smoke.mjs:
 * forged/expired tokens, RSC requests, persistence-verified write denials,
 * open redirects and token replay after sign-out.
 *
 *   AUDIT_URL=http://127.0.0.1:3197 DEMO_PASSWORD=... SESSION_SECRET=... \
 *     PLAYWRIGHT_PACKAGE=/path/to/playwright node scripts/audit-authorization-probe.mjs
 *
 * A check marked `knownGap: true` documents a confirmed limitation, not a pass.
 */
import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");

const origin = process.env.AUDIT_URL || "http://127.0.0.1:3197";
const { DEMO_PASSWORD: password, SESSION_SECRET: secret } = process.env;
if (!password || !secret) throw new Error("Disposable credentials required");
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
  throw new Error("This probe only runs against a local disposable server");

const b64url = (value) => Buffer.from(value).toString("base64url");
function sign(payload, key = secret) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(createHmac("sha256", key).update(body).digest())}`;
}
const now = () => Math.floor(Date.now() / 1000);
const token = (persona, extra = {}) =>
  sign({
    sid: randomUUID(),
    name: `Audit ${persona}`,
    persona,
    exp: now() + 3600,
    ...extra,
  });

const results = [];
function record(id, description, expected, actual, pass, extra = {}) {
  results.push({ id, description, expected, actual, pass, ...extra });
  const label = pass ? "PASS" : extra.knownGap ? "GAP " : "FAIL";
  console.log(`${label} ${id}: ${actual}`);
}

async function get(path, cookie, headers = {}) {
  const res = await fetch(origin + path, {
    redirect: "manual",
    headers: { ...(cookie ? { cookie: `cd_auth=${cookie}` } : {}), ...headers },
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    headers: res.headers,
  };
}
const toLogin = (r) => r.status === 307 && !!r.location?.includes("/login");

// H: baseline security headers (#197).
for (const path of ["/login", "/api/watch/run"]) {
  const r = await get(path);
  const csp = r.headers.get("content-security-policy") ?? "";
  const ok =
    csp.includes("frame-ancestors 'none'") &&
    r.headers.get("x-frame-options") === "DENY" &&
    r.headers.get("x-content-type-options") === "nosniff" &&
    !!r.headers.get("referrer-policy");
  record(
    `H ${path}`,
    `security headers on ${path}`,
    "CSP, XFO, nosniff, referrer",
    ok ? "present" : "missing",
    ok,
    { issue: 197 },
  );
}

// C: cron route requires its bearer secret.
{
  const r = await get("/api/watch/run", null, {
    authorization: "Bearer wrong",
  });
  record(
    "C1",
    "cron watch run rejects a wrong bearer token",
    "401",
    String(r.status),
    r.status === 401,
  );
}

// A: authentication.
{
  const r = await get("/clients");
  record(
    "A1",
    "unauthenticated protected route",
    "307 /login",
    `${r.status} ${r.location}`,
    toLogin(r),
  );
  const [body, sig] = token("CLIENT").split(".");
  const forged = JSON.parse(Buffer.from(body, "base64url").toString());
  forged.persona = "ANALYST";
  const t = await get("/queue", `${b64url(JSON.stringify(forged))}.${sig}`);
  record(
    "A2",
    "persona changed without re-signing",
    "307 /login",
    `${t.status} ${t.location}`,
    toLogin(t),
  );
  const e = await get("/queue", token("ANALYST", { exp: now() - 1 }));
  record(
    "A3",
    "expired signed token",
    "307 /login",
    `${e.status} ${e.location}`,
    toLogin(e),
  );
  const u = await get("/queue", token("ADMIN"));
  record(
    "A4",
    "unknown persona in a signed token",
    "307 /login",
    `${u.status} ${u.location}`,
    toLogin(u),
  );
  const w = await get(
    "/queue",
    sign(JSON.parse(Buffer.from(body, "base64url").toString()), "x".repeat(64)),
  );
  record(
    "A5",
    "token signed with a different secret",
    "307 /login",
    `${w.status} ${w.location}`,
    toLogin(w),
  );
}

// R: route-level persona boundaries, including RSC and export requests.
const denied = {
  CLIENT: [
    "/",
    "/clients",
    "/clients/cli_0002",
    "/queue",
    "/audit",
    "/portfolio/export",
    "/credit-memos/cli_0001/export",
    "/trust/replay",
  ],
  AUDITOR: ["/queue", "/batches", "/borrowing-base"],
  CHECKER: ["/audit"],
};
for (const [persona, paths] of Object.entries(denied)) {
  const cookie = token(persona);
  for (const path of paths) {
    for (const rsc of [false, true]) {
      const r = await get(
        path + (rsc ? "?_rsc=audit" : ""),
        cookie,
        rsc ? { rsc: "1" } : {},
      );
      const home =
        persona === "CLIENT"
          ? "/demo/client"
          : persona === "AUDITOR"
            ? "/audit"
            : "/queue";
      const ok =
        r.status === 307 && new URL(r.location, origin).pathname === home;
      record(
        `R ${persona} ${path}${rsc ? " RSC" : ""}`,
        `${persona} denied ${path}`,
        `307 ${home}`,
        `${r.status} ${r.location ?? ""}`,
        ok,
      );
    }
  }
}
{
  const r = await get("/demo/client", token("CLIENT"));
  record(
    "R CLIENT own",
    "CLIENT reaches its own snapshot",
    "200",
    String(r.status),
    r.status === 200,
  );
  const a = await get("/audit", token("AUDITOR"));
  record(
    "R AUDITOR audit",
    "AUDITOR reaches audit history",
    "200",
    String(a.status),
    a.status === 200,
  );
}

const browser = await chromium.launch({ headless: true });

// The local server has no proxy, so x-real-ip selects a rate-limit bucket.
const ipContext = () =>
  browser.newContext({
    extraHTTPHeaders: {
      "x-real-ip": `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    },
  });

// L: password attempts are limited per client address.
{
  const context = await ipContext();
  const page = await context.newPage();
  let message = "";
  for (let i = 0; i < 11; i++) {
    await page.goto(`${origin}/login`);
    await page.locator("#name").fill("Audit analyst");
    await page.locator("#password").fill(`wrong-${i}`);
    await page
      .locator('form[aria-label="Reviewer sign in"] button[type=submit]')
      .click();
    const alert = page.getByText(
      /That password is not right|Too many attempts/,
    );
    await alert.first().waitFor({ timeout: 20000 });
    message = (await alert.first().textContent()) ?? "";
  }
  record(
    "L1",
    "11th wrong password from one address is refused",
    "Too many attempts",
    message.trim(),
    /Too many attempts/.test(message),
  );
  await context.close();
}

// O: open redirect after a real password sign-in.
for (const next of [
  "//evil.example/x",
  "/\\evil.example",
  "https://evil.example/",
]) {
  const context = await ipContext();
  const page = await context.newPage();
  await page.goto(`${origin}/login?next=${encodeURIComponent(next)}`);
  await page.locator("#name").fill("Audit analyst");
  await page.locator("#password").fill(password);
  await page.locator("#persona").selectOption("ANALYST");
  await page
    .locator('form[aria-label="Reviewer sign in"] button[type=submit]')
    .click();
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20000 });
  const url = new URL(page.url());
  record(
    `O ${next}`,
    "sign-in next parameter stays on site",
    origin,
    url.origin + url.pathname,
    url.origin === origin,
  );
  await context.close();
}

// S: sign-out clears the browser, but the token is not revoked server-side.
{
  const cookie = token("ANALYST");
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "cd_auth",
      value: cookie,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  await page.goto(origin + "/queue");
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await page.waitForURL((u) => u.pathname === "/login");
  const cleared = !(await context.cookies()).some((c) => c.name === "cd_auth");
  record(
    "S1",
    "sign-out clears the browser cookie",
    "cleared",
    cleared ? "cleared" : "present",
    cleared,
  );
  const replay = await get("/queue", cookie);
  record(
    "S2",
    "captured token replayed after sign-out",
    "rejected",
    String(replay.status),
    replay.status !== 200,
    { knownGap: replay.status === 200, issue: 109 },
  );
  await context.close();
}

// W: server actions enforce persona and public-demo write limits, verified by
// persistence. The intruder submits a unique reason through the analyst's
// form; after a reload that reason must not be recorded, while the analyst's
// own unique reason, submitted the same way, must be.
async function chooseHold(form, reason) {
  // Clicks before hydration are ignored; retry until the form accepts a choice.
  const save = form.getByRole("button", { name: "Save decision" });
  for (let i = 0; i < 40 && !(await save.isEnabled()); i++) {
    await form.getByText("Hold", { exact: true }).click();
    await form.page().waitForTimeout(250);
  }
  await form.locator("textarea[name=reason]").fill(reason);
}

let attempt = 0;
async function decisionAttempt(label, intruderClaims) {
  const sid = randomUUID();
  const analyst = token("ANALYST", { sid, name: "Audit probe" });
  const context = await browser.newContext();
  const setCookie = (value) =>
    context.addCookies([
      { name: "cd_auth", value, url: origin, httpOnly: true, sameSite: "Lax" },
    ]);
  await setCookie(analyst);
  const page = await context.newPage();
  await page.goto(origin + "/batches");
  await page.goto(
    origin +
      (await page
        .locator('a[href^="/batches/bat_"]')
        .first()
        .getAttribute("href")),
  );
  const href = await page
    .locator('a[href*="invoice=inv_"]')
    .nth(attempt++)
    .getAttribute("href");
  await page.goto(origin + href);
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Save decision" }) });
  await form.waitFor({ timeout: 20000 });
  const intruderReason = `INTRUDER ${randomUUID()}`;
  await chooseHold(form, intruderReason);
  await context.clearCookies();
  await setCookie(
    token(intruderClaims.persona, {
      sid,
      name: "Audit probe",
      ...intruderClaims,
    }),
  );
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const actionResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("invoice="),
  );
  await form.getByRole("button", { name: "Save decision" }).click();
  const response = await actionResponse;
  let denial;
  if (response.status() === 307) {
    // Proxy refuses before the action runs (#199 covers the client error).
    await page.waitForTimeout(1500);
    denial = `proxy 307 to ${new URL(response.headers().location, origin).pathname}`;
  } else {
    await form
      .locator("p[role=status]")
      .filter({ hasText: /\S/ })
      .waitFor({ timeout: 20000 });
    denial = (await form.locator("p[role=status]").textContent())?.trim() ?? "";
  }
  await context.clearCookies();
  await setCookie(analyst);
  const panelText = async () => {
    await page.goto(origin + href);
    // The invoice panel streams in after the shell; read it once present.
    await page
      .getByText("A new decision is a revision.")
      .waitFor({ timeout: 20000 });
    return page.locator("main").innerText();
  };
  const intruderPersisted = (await panelText()).includes(intruderReason);
  const analystReason = `ANALYST ${randomUUID()}`;
  await form.waitFor({ timeout: 20000 });
  await chooseHold(form, analystReason);
  await form.getByRole("button", { name: "Save decision" }).click();
  await page
    .getByText(analystReason)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  const analystPersisted = (await panelText()).includes(analystReason);
  record(
    `W ${label}`,
    `${label} cannot record a decision through the analyst form`,
    "intruder reason absent; analyst reason recorded",
    `${denial} | intruder persisted=${intruderPersisted} | analyst persisted=${analystPersisted}`,
    !intruderPersisted && analystPersisted,
    { invoice: href },
  );
  if (pageErrors.length)
    record(
      `U ${label}`,
      `${label} denied submission is handled without a client error`,
      "message, no error",
      pageErrors[0],
      false,
      { knownGap: true, issue: 199 },
    );
  await context.close();
}
await decisionAttempt("CLIENT", { persona: "CLIENT" });
await decisionAttempt("CHECKER", { persona: "CHECKER" });
await decisionAttempt("AUDITOR", { persona: "AUDITOR" });
await decisionAttempt("public ANALYST", {
  persona: "ANALYST",
  publicDemo: true,
});

await browser.close();
const summary = {
  origin,
  ranAt: new Date().toISOString(),
  total: results.length,
  passed: results.filter((r) => r.pass).length,
  knownGaps: results.filter((r) => r.knownGap).length,
  failed: results.filter((r) => !r.pass && !r.knownGap).length,
  results,
};
await fs.writeFile(
  process.env.AUDIT_OUT || "audit-authorization-results.json",
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify({
    total: summary.total,
    passed: summary.passed,
    knownGaps: summary.knownGaps,
    failed: summary.failed,
  }),
);
process.exit(summary.failed ? 1 : 0);
