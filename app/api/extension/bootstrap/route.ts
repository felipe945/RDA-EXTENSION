// C2 — everything the extension needs to configure itself, in one call,
// authenticated by the repToken alone.
import { type NextRequest } from "next/server";
import { verifyRepToken } from "@/lib/extension-token";
import { supabaseServer } from "@/lib/supabase";
import {
  getGoogleIntegration,
  hasCalendarScope,
  DEFAULT_TIMEZONE,
  DEFAULT_SLOT_MINS,
} from "@/lib/google-calendar";

// The extension caches this dashboardUrl and routes ALL its calls to it, so it
// must be the stable alias — never getBaseUrl(), which resolves to Vercel's
// immutable per-deployment URL (frozen at old code / garbage-collected on the
// next deploy). Echo back the host the extension actually called.
function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const rep = await verifyRepToken(req.headers.get("authorization"));
  if (!rep) return Response.json({ ok: false }, { status: 401 });

  const db = supabaseServer();
  const { data: user } = await db
    .from("users")
    .select("*")
    .eq("id", rep.rep_id)
    .maybeSingle();
  const google = await getGoogleIntegration(rep.rep_id);

  return Response.json({
    ok: true,
    dashboardUrl: requestOrigin(req),
    fanbasisHandle: "fanbasis",
    rep: {
      id: rep.rep_id,
      email: user?.email ?? rep.email,
      name: user?.name ?? rep.name,
      personalIgUsername: user?.personal_ig_username ?? null,
    },
    calendar: {
      connected: !!google?.refresh_token && hasCalendarScope(google?.scopes),
      slotMins: google?.slot_mins ?? DEFAULT_SLOT_MINS,
      timezone: google?.timezone ?? DEFAULT_TIMEZONE,
    },
  });
}
