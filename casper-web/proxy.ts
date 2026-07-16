import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const target = new URL("/sign-in", request.url);
    target.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(target);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/pipeline/:path*",
    "/deals/:path*",
    "/companies/:path*",
    "/contacts/:path*",
    "/approvals/:path*",
    "/feedback/:path*",
  ],
};
