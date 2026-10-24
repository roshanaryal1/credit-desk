import { redirect } from "next/navigation";
import { Suspense } from "react";

/** Preserve the alternate review URL with one canonical collateral view. */
export default function ClientCollateralRedirect({
  params,
}: PageProps<"/borrowing-base/clients/[id]">) {
  return (
    <Suspense fallback={null}>
      <RedirectToClient params={params} />
    </Suspense>
  );
}

async function RedirectToClient({
  params,
}: Pick<PageProps<"/borrowing-base/clients/[id]">, "params">): Promise<never> {
  const { id } = await params;
  return redirect(`/clients/${encodeURIComponent(id)}/borrowing-base`);
}
