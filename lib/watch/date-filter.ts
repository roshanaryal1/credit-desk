import { z } from "zod";

import { addDays, isBusinessDate } from "@/lib/dates";
import { DEMO_TODAY, HISTORY_DAYS } from "@/lib/demo";

export const WATCH_HISTORY_START = addDays(DEMO_TODAY, -HISTORY_DAYS);
const dateQuery = z.string().refine(isBusinessDate);

/** Malformed or repeated dates fall back; valid dates clamp to demo history. */
export function clampWatchDate(value: unknown): string {
  const parsed = dateQuery.safeParse(value);
  if (!parsed.success) return DEMO_TODAY;
  if (parsed.data < WATCH_HISTORY_START) return WATCH_HISTORY_START;
  if (parsed.data > DEMO_TODAY) return DEMO_TODAY;
  return parsed.data;
}
