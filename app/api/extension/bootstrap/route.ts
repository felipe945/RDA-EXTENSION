// C2 — everything the extension needs to configure itself, in one call,
// authenticated by the repToken alone.
import { type NextRequest } from "next/server";
import { verifyRepToken } from "@/lib/extension-token";
import { supabaseServer } from "@/lib/supabase";
import { getBaseUrl } from "@/lib/base-url";
import {
  getGoogleIntegration,
  hasCalendarScope,
  DEFAULT_TIMEZONE,
  DEFAULT_SLOT_MINS,
} from "@/lib/google-calendar";

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
    dashboardUrl: getBaseUrl(),
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
