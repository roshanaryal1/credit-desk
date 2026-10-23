export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Invoice Check</h1>
      <p className="text-muted-foreground">
        Funding batches will appear here. See SPEC.md for the build plan.
      </p>
    </main>
  );
}
