import { describe, it, expect } from "vitest";
import { workItems } from "@/lib/queue/work-items";

describe("review queue ordering", () => {
  const batches = [
    {id:"x",clientName:"B",status:"PENDING",submittedDate:"2026-10-10",highRisk:0,flagged:2,invoiceCount:3,faceCents:1000},
    {id:"y",clientName:"A",status:"PENDING",submittedDate:"2026-10-11",highRisk:1,flagged:0,invoiceCount:1,faceCents:3000},
    {id:"old",clientName:"C",status:"REVIEWED",submittedDate:"2026-10-12",highRisk:3,flagged:0,invoiceCount:2,faceCents:2000},
  ];
  const incidents = [
    {id:"i1",clientName:"A",severity:"HIGH",firstDetectedDate:"2026-10-08",status:"OPEN",ruleId:"OVERDUE_FUNDED"},
    {id:"i2",clientName:"A",severity:"HIGH",firstDetectedDate:"2026-10-08",status:"RESOLVED",ruleId:"FACILITY_UTILISATION"},
  ];
  it("shows only active records, prioritizing high risk, then date", () => {
    const rows = workItems(batches,incidents,"2026-10-24");
    expect(rows.map(x => x.key)).toEqual(["incident:i1","batch:y","batch:x"]);
    expect(rows[0]?.amountCents).toBeNull();
    expect(rows[1]?.amountLabel).toBe("Batch face");
    expect(rows[1]?.href).toBe("/batches/y");
  });
  it("never includes future submissions or resolved risks", () => {
    const rows=workItems(batches,incidents,"2026-10-09");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("incident:i1");
  });
});
