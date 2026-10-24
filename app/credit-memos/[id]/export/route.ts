import { eq } from "drizzle-orm";

import { draftMemoFromSyntheticClient } from "@/lib/credit/memo-demo";
import { renderSyntheticMemoMarkdown } from "@/lib/credit/memo-export";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { fundsInUseByClient } from "@/lib/queries/book";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/credit-memos/[id]/export">,
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }
  const db = await getDb();
  const [client] = await db.select().from(t.clients)
    .where(eq(t.clients.id, id)).limit(1);
  if (!client) return new Response("Not found", { status: 404 });
  const funds = await fundsInUseByClient();
  const memo = draftMemoFromSyntheticClient({
    id,
    name: client.name,
    facilityLimitCents: client.facilityLimitCents,
    fundsInUseCents: funds.get(id) ?? 0,
  });
  const markdown = renderSyntheticMemoMarkdown(memo);
  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"credit-memo-" + id + "-DRAFT.md\"",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
