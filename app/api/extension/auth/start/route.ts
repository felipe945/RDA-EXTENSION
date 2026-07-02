// C1 — auth handoff for the Chrome extension (one-Google-sign-in setup).
// The extension opens this via chrome.identity.launchWebAuthFlow with
// ext_redirect = chrome.identity.getRedirectURL(). We reuse the rep's normal
// NextAuth session (bouncing through /login if there isn't one), mint a
// 90-day repToken, and land back on the extension's redirect with the token
// in the URL fragment (fragments never hit any server log).
import { type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { mintRepToken } from "@/lib/extension-token";
import { supabaseServer } from "@/lib/supabase";

// Build the origin from the host the client actually hit (the stable alias
// the extension calls), NOT getBaseUrl() — which resolves to Vercel's immutable
// per-deployment URL. Bouncing /login to the immutable host would set the
// session cookie on the wrong host, so a rep already signed into the dashboard
// gets needlessly re-prompted (and a deployment-protected host could hard-block
// the bounce). Staying on the caller's host reuses the existing session.
function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

function validExtRedirect(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // chrome.identity redirect URLs are always https://<extension-id>.chromiumapp.org/
  if (url.protocol !== "https:") return null;
  if (!url.hostname.endsWith(".chromiumapp.org")) return null;
  return url;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("ext_redirect");
  const extRedirect = validExtRedirect(raw);
  if (!extRedirect) {
    return Response.json(
      { ok: false, error: "ext_redirect must be an https://*.chromiumapp.org/ URL" },
      { status: 400 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    // No dashboard session — run the normal Google sign-in, then come back
    // here with ext_redirect intact. Relative callbackUrl keeps NextAuth's
    // same-origin redirect check happy.
    const callbackUrl = `/api/extension/auth/start?ext_redirect=${encodeURIComponent(extRedirect.href)}`;
    const login = new URL("/login", requestOrigin(req));
    login.searchParams.set("callbackUrl", callbackUrl);
    return Response.redirect(login, 302);
  }

  // select * — tolerates the window before migration 014 adds
  // extension_token_version (defaults to 1 below).
  const db = supabaseServer();
  const { data: user } = await db
    .from("users")
    .select("*")
    .eq("id", session.userId)
    .maybeSingle();
  if (!user) {
    return Response.json({ ok: false, error: "unknown user" }, { status: 401 });
  }

  const token = await mintRepToken({
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    team_id: session.orgId ?? null,
    extension_token_version: user.extension_token_version ?? 1,
  });

  return Response.redirect(`${extRedirect.href}#token=${token}`, 302);
}
