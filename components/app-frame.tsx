import type { ReactNode } from "react";

/**
 * Keep the workspace shell server-rendered. CSS scopes the full-bleed login
 * based on its own landmark, without client-side router hooks on static routes.
 */
export function AppFrame({
  navigation,
  children,
}: {
  navigation: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="credit-desk-frame flex flex-1 flex-col md:flex-row">
      {navigation}
      <main
        id="main"
        tabIndex={-1}
        className="credit-desk-content flex-1 px-4 py-6 md:px-8 md:py-8"
      >
        <div className="credit-desk-content-inner mx-auto flex max-w-7xl flex-col gap-8">
          {children}
        </div>
      </main>
    </div>
  );
}
