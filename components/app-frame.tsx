"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The login gets its own full-width presentation; workspace chrome stays intact. */
export function AppFrame({
  navigation,
  children,
}: {
  navigation: ReactNode;
  children: ReactNode;
}) {
  const isLogin = usePathname() === "/login";
  if (isLogin) {
    return (
      <main id="main" tabIndex={-1} className="flex w-full flex-1">
        {children}
      </main>
    );
  }
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      {navigation}
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 px-4 py-6 md:px-8 md:py-8"
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-8">
          {children}
        </div>
      </main>
    </div>
  );
}
