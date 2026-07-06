// Auth wall. In Next.js 16 the `middleware` file convention was deprecated and
// renamed to `proxy` (node_modules/next/dist/docs/.../16-proxy.md). Named `proxy`
// export with a NextRequest arg is the v16-correct form.
//
// Gates both pages AND /api routes:
//   - unauthenticated page request  -> redirect to /login
//   - unauthenticated /api request  -> 401 JSON (never redirect a fetch to HTML)
//
// Some /api routes must stay open because they don't carry a NextAuth session:
//   - /api/auth/*            NextAuth sign-in / session / callback
//   - /api/ig-events         Chrome extension, authenticates via x-ig-secret
//   - /api/sendblue          SMS webhook, authenticates via its own secret
//   - /api/inngest           Inngest, authenticates via signed requests
//   - /api/leads/batch-enrich, /api/salesforce/batch
//                            CLI/script callers — require `Authorization: Bearer
//                            $CRON_SECRET` (hasInternalSecret, fail-closed)
//   - /api/ai/research-lead  self-authenticates via getActor OR CRON_SECRET
//                            (Inngest fn / drain / ig-events fallback send the
//                            secret; extension sends Bearer repToken)
//   - /api/opener            self-authenticates via getActor (session or Bearer
//                            repToken) + CORS origin allowlist — no cookie needed
//                            so it stays open here (extension calls pre-session)
//   - /api/log               logging sink (may fire before a session exists)
//   - /api/invites/preview   login-page invite lookup; the visitor isn't signed
//                            in yet — the uuid invite token is the credential
//   - /api/extension/*       Chrome extension: auth/start does its own session
//                            check (and must redirect a fresh browser tab to
//                            /login, not 401); bootstrap verifies the repToken
//   - /api/calendar/*        Chrome extension, authenticates via repToken
//   - /api/leads/*, /api/messages, /api/notifications, /api/stats/*
//                            SPLIT wave: authenticated by getActor() in every
//                            handler — NextAuth session OR Bearer repToken
//                            (the extension has no cookie). assign-next adds a
//                            role gate (admin/owner) on top of getActor;
//                            bulk-import does its own getServerSession check.
// These each authenticate themselves internally, so bypassing the session check
// here does not expose data.
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

const OPEN_API_PREFIXES = [
  "/api/auth",
  "/api/ig-events",
  "/api/sendblue",
  "/api/inngest",
  "/api/leads",
  "/api/messages",
  "/api/notifications",
  "/api/stats",
  "/api/salesforce/batch",
  "/api/ai/research-lead",
  "/api/opener",
  "/api/log",
  "/api/invites/preview",
  "/api/extension",
  "/api/calendar",
];

function isOpenApi(pathname: string): boolean {
  return OPEN_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Self-authenticating / internal API routes pass through untouched.
  if (isOpenApi(pathname)) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return NextResponse.next();

  // Unauthenticated.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/leads/:path*",
    "/inbox/:path*",
    "/outreach/:path*",
    "/scripts/:path*",
    "/settings/:path*",
    "/api/:path*",
  ],
};
