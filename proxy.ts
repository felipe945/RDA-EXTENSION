// Auth wall. In Next.js 16 the `middleware` file convention was deprecated and
// renamed to `proxy` (node_modules/next/dist/docs/.../proxy.md). This is the
// v16-correct location for what TEAM_T1_FOUNDATION.md calls middleware.ts.
//
// The proxy loader statically requires a locally-declared function export (a bare
// `export { default } from "next-auth/middleware"` re-export is NOT detected), so
// we wrap next-auth's middleware in a named `proxy` function. We configure it with
// pages.signIn so unauthenticated visitors hit our /login page rather than
// next-auth's default /api/auth/signin.
import withAuth, { type NextRequestWithAuth } from "next-auth/middleware";
import type { NextFetchEvent } from "next/server";

const authMiddleware = withAuth({ pages: { signIn: "/login" } });

export function proxy(req: NextRequestWithAuth, event: NextFetchEvent) {
  return authMiddleware(req, event);
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/leads/:path*",
    "/inbox/:path*",
    "/outreach/:path*",
    "/summary/:path*",
    "/scripts/:path*",
    "/settings/:path*",
  ],
};
