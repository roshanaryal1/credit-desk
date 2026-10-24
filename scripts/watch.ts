import { parseArgs } from "node:util";

import { addDays } from "@/lib/dates";
import { closeDb, getDb } from "@/lib/db/client";
import { DEMO_TODAY, HISTORY_DAYS } from "@/lib/demo";
import { runWatchRange } from "@/lib/watch/runner";

// Usage: npm run watch -- --as-of=YYYY-MM-DD | --from=YYYY-MM-DD --to=YYYY-MM-DD | --history

const { values } = parseArgs({
  options: {
    "as-of": { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    history: { type: "boolean", default: false },
  },
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  const from = values.history
    ? addDays(DEMO_TODAY, -HISTORY_DAYS)
    : (values["as-of"] ?? values.from);
  const to = values.history ? DEMO_TODAY : (values["as-of"] ?? values.to);
  if (!from || !to || !DATE.test(from) || !DATE.test(to) || from > to) {
    throw new Error(
      "give --as-of=YYYY-MM-DD, or --from and --to, or --history",
    );
  }
  const db = await getDb();
  const detections = await runWatchRange(db, from, to);
  console.log(`Watch ran ${from} to ${to}: ${detections} detections.`);
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exitCode = 1;
  });
