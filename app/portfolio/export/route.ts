import { getDb } from "@/lib/db/client";
import { DEMO_TODAY } from "@/lib/demo";
import { renderPortfolioReviewPack } from "@/lib/portfolio/review-pack";
import { syntheticPortfolioReviewPack } from "@/lib/queries/portfolio-review-pack";

function validDate(value: string): boolean {
  const date = Date.parse(value + "T00:00:00Z");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date) &&
    new Date(date).toISOString().slice(0, 10) === value &&
    value <= DEMO_TODAY
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const asOf = url.searchParams.get("asOf") ?? DEMO_TODAY;
  const selectedClientId = url.searchParams.get("client");
  if (
    !validDate(asOf) ||
    (selectedClientId !== null &&
      !/^[A-Za-z0-9_-]{1,64}$/.test(selectedClientId))
  ) {
    return new Response("Invalid synthetic portfolio scope", { status: 400 });
  }

  try {
    const db = await getDb();
    const pack = await syntheticPortfolioReviewPack(db, asOf, selectedClientId);
    if (!pack) return new Response("Client not found", { status: 404 });
    const result = renderPortfolioReviewPack(pack);
    const suffix = selectedClientId ? "-" + selectedClientId : "";
    return new Response(result.markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="creditdesk-portfolio-' +
          asOf +
          suffix +
          '.md"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Portfolio-Digest": result.digest,
      },
    });
  } catch {
    // Do not leak internal source details or silently produce zero balances.
    return new Response("Synthetic source reconciliation unavailable", {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
