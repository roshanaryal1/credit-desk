// Fails if a secret name or value appears in the browser bundle (SPEC 11).
// Run after `next build`. Values are read from the environment and never printed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".next/static";
const NAMES = [
  "LLM_API_KEY",
  "DATABASE_URL",
  "DEMO_PASSWORD",
  "SESSION_SECRET",
  "CRON_SECRET",
];
const values = NAMES.map((n) => process.env[n]).filter(
  (v) => v && v.length >= 8,
);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|css|html|json|map)$/.test(name)) yield path;
  }
}

let problems = 0;
let scanned = 0;
for (const file of files(ROOT)) {
  scanned++;
  const text = readFileSync(file, "utf8");
  for (const name of NAMES) {
    if (text.includes(name)) {
      console.error(`secret name ${name} found in ${file}`);
      problems++;
    }
  }
  if (values.some((v) => text.includes(v))) {
    console.error(`a secret value was found in ${file}`);
    problems++;
  }
}
console.log(
  `Scanned ${scanned} client files for ${NAMES.length} secret names and ${values.length} secret values.`,
);
if (problems > 0) process.exit(1);
