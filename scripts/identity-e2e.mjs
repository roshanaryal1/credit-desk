/**
 * Browser journeys for verified identity (#109) against a local production
 * build in AUTH_MODE=oidc and scripts/mock-oidc-provider.mjs. Local only.
 *
 *   IDENTITY_URL=http://127.0.0.1:3109 INVOICE_BY_CLIENT='{"cli_0001":"inv_0001",...}' \
 *     node scripts/identity-e2e.mjs
 *
 * Expects: admin@bank.test provisioned as ADMIN, nomfa@bank.test provisioned
 * as ANALYST, and mock IdP users admin, analyst, nomfa (password only) and
 * stranger (not provisioned).
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");

const origin = process.env.IDENTITY_URL || "http://127.0.0.1:3109";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
  throw new Error("Identity E2E only runs against a local server");
const invoiceByClient = JSON.parse(process.env.INVOICE_BY_CLIENT ?? "{}");

const results = [];
function record(id, expected, actual, pass) {
  results.push({ id, expected, actual, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${actual}`);
}

const browser = await chromium.launch();
// The test IdP uses a throwaway self-signed certificate.
const newContext = () => browser.newContext({ ignoreHTTPSErrors: true });

async function signIn(context, email, next = "/") {
  const page = await context.newPage();
  await page.goto(`${origin}/login?next=${encodeURIComponent(next)}`);
  await page
    .getByRole("link", { name: "Sign in with your organisation" })
    .click();
  await page.getByRole("link", { name: `Sign in as ${email}` }).click();
  await page.waitForURL(
    (u) => u.origin === origin && u.pathname !== "/auth/callback",
  );
  await page.waitForLoadState("domcontentloaded");
  return page;
}
const sessionCookie = async (context) =>
  (await context.cookies()).find((c) => c.name === "cd_session");
async function status(path, token) {
  const res = await fetch(origin + path, {
    redirect: "manual",
    headers: token ? { cookie: `cd_session=${token}` } : {},
  });
  return `${res.status} ${res.headers.get("location") ?? ""}`.trim();
}
/** The streamed sign-in error message, once rendered. */
async function alertText(page) {
  // Next.js adds an empty route announcer with role="alert"; take the message.
  const alert = page.getByRole("alert").filter({ hasText: /\S/ }).first();
  await alert.waitFor({ timeout: 15000 }).catch(() => {});
  return ((await alert.textContent().catch(() => "")) ?? "").trim();
}
async function chooseHold(form, reason) {
  const save = form.getByRole("button", { name: "Save decision" });
  for (let i = 0; i < 40 && !(await save.isEnabled()); i++) {
    await form.getByText("Hold", { exact: true }).click();
    await form.page().waitForTimeout(250);
  }
  await form.locator("textarea[name=reason]").fill(reason);
  return save;
}

// 1. Administrator signs in (MFA asserted by the IdP) and lands on administration.
const adminCtx = await newContext();
const admin = await signIn(adminCtx, "admin@bank.test", "/queue");
const adminPath = new URL(admin.url()).pathname;
record(
  "I1 admin sign-in",
  "/admin/users",
  adminPath,
  adminPath === "/admin/users",
);

// 2. Administrator provisions an analyst with access to one client only.
const provision = admin
  .locator("form")
  .filter({ has: admin.getByRole("button", { name: "Provision user" }) });
await provision.getByLabel("Work email").fill("analyst@bank.test");
await provision.getByLabel("Display name").fill("Ana Lyst");
await provision.getByLabel("analyst", { exact: true }).check();
const firstClient = provision.locator('input[name="clientIds"]').first();
const grantedClient = await firstClient.getAttribute("value");
await firstClient.check();
await provision.getByRole("button", { name: "Provision user" }).click();
const saved = await provision
  .getByRole("status")
  .filter({ hasText: /\S/ })
  .textContent({ timeout: 15000 });
record(
  "I2 provision analyst",
  "User provisioned",
  saved?.trim(),
  /provisioned/i.test(saved ?? ""),
);

// 3. Analyst signs in; client-scoped routes follow grants.
const analystCtx = await newContext();
const analyst = await signIn(analystCtx, "analyst@bank.test", "/queue");
const analystPath = new URL(analyst.url()).pathname;
// Partial grants land on their own client, never portfolio-wide pages.
record(
  "I3 analyst sign-in",
  `/clients/${grantedClient}`,
  analystPath,
  analystPath === `/clients/${grantedClient}`,
);
const token = (await sessionCookie(analystCtx))?.value;
// The prerendered fallback shows only /about; wait for the streamed nav.
await analyst
  .locator(`nav[aria-label="Main"] a[href="/clients/${grantedClient}"]`)
  .first()
  .waitFor({ timeout: 15000 })
  .catch(() => {});
const navLinks = await analyst
  .locator('nav[aria-label="Main"]')
  .last()
  .locator("a")
  .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
record(
  "I3b nav lists granted client only",
  `/clients/${grantedClient}`,
  navLinks.join(" "),
  navLinks.includes(`/clients/${grantedClient}`) &&
    !navLinks.some((h) => ["/", "/queue", "/clients", "/audit"].includes(h)),
);
const otherClient = Object.keys(invoiceByClient).find(
  (c) => c !== grantedClient,
);
const checks = [
  ["I4 granted client", `/clients/${grantedClient}`, "200"],
  ["I5 ungranted client", `/clients/${otherClient}`, "404"],
  ["I6 ungranted memo export", `/credit-memos/${otherClient}/export`, "404"],
  ["I7 analyst blocked from admin", "/admin/users", "307"],
  ["I8 borrower demo hidden", "/demo/client", "307"],
  [
    "I8b portfolio export withheld",
    `/portfolio/export?client=${otherClient}`,
    "307",
  ],
];
for (const [id, path, expected] of checks) {
  const actual = await status(path, token);
  record(id, expected, actual, actual.startsWith(expected));
}

// 4. Analyst records a decision on a granted invoice; attribution is verified.
await analyst.goto(`${origin}/clients/${grantedClient}`);
const batchHref = await analyst
  .locator('a[href^="/batches/bat_"]')
  .first()
  .getAttribute("href")
  .catch(() => null);
let invoiceHref = null;
for (const href of batchHref ? [batchHref] : []) {
  const html = await (
    await fetch(origin + href, { headers: { cookie: `cd_session=${token}` } })
  ).text();
  invoiceHref =
    /href="(\/batches\/bat_[^"?]+\?invoice=inv_[a-z0-9_]+)"/.exec(html)?.[1] ??
    null;
}
if (!invoiceHref) {
  record(
    "I9 decision persisted with verified name",
    "invoice found",
    "no granted batch link",
    false,
  );
} else {
  await analyst.goto(origin + invoiceHref);
  const form = analyst
    .locator("form")
    .filter({ has: analyst.getByRole("button", { name: "Save decision" }) });
  const reason = `Verified analyst hold ${Date.now()}`;
  await (await chooseHold(form, reason)).click();
  await analyst.waitForTimeout(2500);
  await analyst.goto(origin + invoiceHref);
  await analyst.getByText("Your decision", { exact: true }).waitFor();
  const panel = await analyst.locator("main").innerText();
  const ok = panel.includes(reason) && panel.includes("Ana Lyst");
  record(
    "I9 decision persisted with verified name",
    "Ana Lyst + reason",
    ok ? "present" : "missing",
    ok,
  );

  // 5. IDOR: rewrite the action's invoice id to another client's invoice.
  const foreign = invoiceByClient[otherClient];
  const own = new URL(origin + invoiceHref).searchParams.get("invoice");
  await analyst.goto(origin + invoiceHref);
  const form2 = analyst
    .locator("form")
    .filter({ has: analyst.getByRole("button", { name: "Save decision" }) });
  const save2 = await chooseHold(form2, "Cross-client attempt");
  await analyst.route(/\/batches\//, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    await route.continue({
      postData: (req.postData() ?? "").split(own).join(foreign),
    });
  });
  await save2.click();
  const message = await form2
    .getByRole("status")
    .filter({ hasText: /\S/ })
    .textContent({ timeout: 15000 })
    .catch(() => "");
  await analyst.unrouteAll();
  record(
    "I10 cross-client decision refused",
    "Invoice not found.",
    message?.trim(),
    (message ?? "").includes("not found"),
  );
}

// 6. Sign-out revokes the session server-side: a copied cookie stops working.
await analyst.goto(`${origin}/clients/${grantedClient}`);
await analyst.getByRole("button", { name: "Sign out", exact: true }).click();
await analyst.waitForURL((u) => u.pathname === "/login");
const replay = await status(`/clients/${grantedClient}`, token);
record(
  "I11 replay after sign-out",
  "307 to /login",
  replay,
  replay.startsWith("307") && replay.includes("/login"),
);

// 7. Administrator revokes every session of a signed-in analyst remotely.
const secondCtx = await newContext();
const again = await signIn(secondCtx, "analyst@bank.test", "/queue");
const token2 = (await sessionCookie(secondCtx))?.value;
const live = await status(`/clients/${grantedClient}`, token2);
record("I12 analyst signed in again", "200", live, live.startsWith("200"));
await admin.goto(`${origin}/admin/users`);
const row = admin.locator("li").filter({ hasText: "analyst@bank.test" });
await row.getByRole("button", { name: "Sign out everywhere" }).click();
await row
  .getByRole("status")
  .filter({ hasText: /revoked/ })
  .first()
  .waitFor({ timeout: 15000 });
await again.goto(`${origin}/clients/${grantedClient}`);
const afterRevoke = new URL(again.url()).pathname;
record(
  "I13 remote revocation",
  "/login",
  afterRevoke,
  afterRevoke === "/login",
);

// 8. Disabled users cannot sign in.
await admin.goto(`${origin}/admin/users`);
await admin
  .locator("li")
  .filter({ hasText: "analyst@bank.test" })
  .getByRole("button", { name: "Disable user" })
  .click();
await admin.waitForTimeout(1500);
const disabled = await signIn(
  await newContext(),
  "analyst@bank.test",
  "/queue",
);
const disabledText = await alertText(disabled);
record(
  "I14 disabled user refused",
  "disabled message",
  disabledText?.trim(),
  /disabled/i.test(disabledText ?? ""),
);

// 9. Password-only and unprovisioned sign-ins are refused without a session.
const nomfaCtx = await newContext();
const nomfa = await signIn(nomfaCtx, "nomfa@bank.test", "/queue");
const nomfaText = await alertText(nomfa);
record(
  "I15 MFA required",
  "multi-factor message",
  nomfaText?.trim(),
  /multi-factor/i.test(nomfaText ?? "") && !(await sessionCookie(nomfaCtx)),
);
const strangerCtx = await newContext();
const stranger = await signIn(strangerCtx, "stranger@bank.test", "/queue");
const strangerText = await alertText(stranger);
record(
  "I16 unprovisioned refused",
  "not given access",
  strangerText?.trim(),
  /not been given access/i.test(strangerText ?? "") &&
    !(await sessionCookie(strangerCtx)),
);

// 10. Administrators cannot lock themselves out.
await admin.goto(`${origin}/admin/users`);
const selfDisable = admin
  .locator("li")
  .filter({ hasText: "admin@bank.test" })
  .getByRole("button", { name: "Disable user" });
record(
  "I17 self-disable unavailable",
  "true",
  String(await selfDisable.isDisabled()),
  await selfDisable.isDisabled(),
);

await browser.close();
const summary = {
  total: results.length,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
  results,
};
await fs.writeFile(
  process.env.IDENTITY_OUT || "identity-e2e-results.json",
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify({
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
  }),
);
process.exit(summary.failed ? 1 : 0);
