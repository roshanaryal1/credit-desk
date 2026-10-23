import { NextResponse, type NextRequest } from "next/server";

// Gives every visitor an analyst session id (SPEC 9.1). The password gate and
// signed sessions are added in SPEC 11 work.

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.get("cd_session")) {
    response.cookies.set("cd_session", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
