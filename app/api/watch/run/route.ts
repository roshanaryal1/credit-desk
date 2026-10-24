import { timingSafeEqual } from "node:crypto";

import { connection } from "next/server";

import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { runWatchForDate } from "@/lib/watch/runner";

// Daily watch run for an optional Vercel Cron job (SPEC 7). Requires
// Authorization: Bearer $CRON_SECRET; exempt from the password gate.

function authorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function GET(request: Request) {
  await connection();
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const detections = await runWatchForDate(await getDb(), DEMO_TODAY);
  console.log(
    JSON.stringify({
      event: "watch_run",
      asOf: DEMO_TODAY,
      detections: detections.length,
    }),
  );
  return Response.json({ asOf: DEMO_TODAY, detections: detections.length });
}
