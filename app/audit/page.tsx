import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Chip } from "@/components/chips";
import { Loading, PageHeader } from "@/components/page";
import { instant } from "@/lib/format";
import { decodeCursor, listAuditEvents } from "@/lib/queries/audit";

export const metadata = { title: "Audit log" };

const ACTIONS: Record<
  string,
  { label: string; tone: "clear" | "flagged" | "high" | "info" | "neutral" }
> = {
  DECISION_APPROVE: { label: "Approved", tone: "clear" },
  DECISION_HOLD: { label: "Held", tone: "flagged" },
  DECISION_REJECT: { label: "Rejected", tone: "high" },
  INCIDENT_ACKNOWLEDGED: { label: "Acknowledged", tone: "info" },
  INCIDENT_RESOLVED: { label: "Resolved", tone: "neutral" },
};

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every decision and incident action, newest first. Entries cannot be edited or deleted. Names are self-declared at sign-in, not verified."
      />
      <Suspense fallback={<Loading label="Loading the audit log..." />}>
        <AuditTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AuditTable({
  searchParams,
}: {
  searchParams: PageProps<"/audit">["searchParams"];
}) {
  await connection();
  const sp = await searchParams;
  const before = decodeCursor(sp.before);
  const { events, next } = await listAuditEvents(before);
  if (events.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing recorded yet. Decisions on invoices and actions on incidents
        appear here.
      </p>
    );
  }
  return (
    <>
      <div className="bg-card overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <caption className="sr-only">Audit events</caption>
          <thead className="text-muted-foreground border-b text-left">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                When (NZ time)
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Who
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Action
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Subject
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Detail
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map((e) => {
              const a = ACTIONS[e.action] ?? {
                label: e.action,
                tone: "neutral" as const,
              };
              const p = e.payload as {
                decisionId?: string;
                reason?: string;
                mode?: string;
                model?: string | null;
                promptVersion?: string | null;
                findings?: string[];
                simulated?: boolean;
              };
              return (
                <tr key={e.id} className="align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {instant(e.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">{e.actor}</td>
                  <td className="px-4 py-2.5">
                    <Chip tone={a.tone}>{a.label}</Chip>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {e.entityId}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    {p.reason ? (
                      <span className="text-foreground block">
                        &ldquo;{p.reason}&rdquo;
                      </span>
                    ) : null}
                    {p.mode ? (
                      <span className="block">
                        {p.mode === "SHADOW" ? "Shadow mode" : "Assist mode"}
                        {p.simulated ? ", simulated history" : ""}
                      </span>
                    ) : null}
                    {p.findings ? (
                      <span className="block">
                        {p.findings.length} checks fired
                      </span>
                    ) : null}
                    {p.model ? (
                      <span className="block">
                        {p.model}, prompt {p.promptVersion}
                      </span>
                    ) : null}
                    {p.decisionId ? (
                      <Link
                        href={`/trust/replay/${p.decisionId}`}
                        className="text-primary underline underline-offset-4"
                      >
                        Replay
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav aria-label="Audit pages" className="flex gap-3 text-sm">
        {before ? (
          <Link
            href="/audit"
            className="text-primary underline underline-offset-4"
          >
            Newest entries
          </Link>
        ) : null}
        {next ? (
          <Link
            href={`/audit?before=${encodeURIComponent(next)}`}
            className="text-primary underline underline-offset-4"
          >
            Older entries
          </Link>
        ) : (
          <span className="text-muted-foreground">End of the log.</span>
        )}
      </nav>
    </>
  );
}
