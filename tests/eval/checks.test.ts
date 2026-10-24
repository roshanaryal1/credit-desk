import { describe, expect, it } from "vitest";

import { gateFailures, scoreChecks } from "@/lib/eval/checks";

const sets = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries).map(([k, v]) => [k, new Set(v)]));

describe("check scoring", () => {
  it("counts tp, fp, fn and tn per check", () => {
    const m = scoreChecks(
      sets({ a: ["DUP"], b: ["DUP"], c: [], d: [] }),
      sets({ a: ["DUP"], b: [], c: ["DUP"], d: [] }),
    );
    expect(m.DUP).toMatchObject({
      tp: 1,
      fp: 1,
      fn: 1,
      tn: 1,
      precision: 0.5,
      recall: 0.5,
    });
  });

  it("reports n/a (null) when there are no positives", () => {
    const m = scoreChecks(sets({ a: [] }), sets({ a: [] }));
    expect(m.VOIDED.precision).toBeNull();
    expect(m.VOIDED.recall).toBeNull();
    expect(gateFailures(m)).toEqual([]);
  });

  it("fails the gate on low precision as well as low recall", () => {
    // Flagging everything gives perfect recall but poor precision.
    const predicted = sets({ a: ["DUP"], b: ["DUP"], c: ["DUP"], d: ["DUP"] });
    const expected = sets({ a: ["DUP"], b: [], c: [], d: [] });
    const failures = gateFailures(scoreChecks(predicted, expected));
    expect(failures).toEqual([
      expect.objectContaining({
        check: "DUP",
        metric: "precision",
        value: 0.25,
      }),
    ]);
  });
});
