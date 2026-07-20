// GET /api/am/conversations — Felipe-only (owner/admin) Pulse board data.
// NOT in proxy.ts OPEN_API_PREFIXES: the wall enforces a session, this handler
// enforces admin. Reps get 401 here even with a valid session.
//   ?view=board     → tracked conversations w/ computed status + deep links + sources
//   ?view=untracked → new threads awaiting Track/Ignore triage
//   ?view=counts    → cheap counts for the nav badge
import { type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { canManageTeam } from "@/lib/permissions";
import { computeStatus, type AmConversationRow } from "@/lib/am/status";

const STALE_HEARTBEAT_MS = 10 * 60_000;

const CONVO_COLUMNS =
  "id, channel, external_id, display_name, client_name, tracked, muted, snoozed_until, " +
  "checkin_days, client_notes, last_msg_at, last_direction, last_msg_preview, " +
  "last_inbound_at, last_outbound_at, handled_at, ai_needs_reply, ai_waiting_on, " +
  "ai_open_commitment, ai_summary, ai_suggested_reply, meta, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLink(c: any): string | null {
  if (c.channel === "whatsapp") {
    const phone = String(c.external_id).split("@")[0].replace(/\D/g, "");
    return phone ? `https://wa.me/${phone}` : null;
  }
  const teamId = (c.meta as Record<string, unknown> | null)?.team_id;
  return typeof teamId === "string" && teamId
    ? `https://app.slack.com/client/${teamId}/${c.external_id}`
    : null;
}

const STATUS_ORDER = { red: 0, amber: 1, green: 2 } as const;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canManageTeam(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const view = req.nextUrl.searchParams.get("view") ?? "board";
  const db = supabaseServer();

  if (view === "untracked") {
    const { data } = await db
      .from("am_conversations")
      .select(CONVO_COLUMNS)
      .eq("org_id", session.orgId)
      .eq("tracked", false)
      .eq("muted", false)
      .order("last_msg_at", { ascending: false, nullsFirst: false })
      .limit(200);
    return Response.json({ conversations: data ?? [] });
  }

  // board + counts both need computed statuses over tracked & !muted.
  const now = new Date();
  const { data: rows } = await db
    .from("am_conversations")
    .select(CONVO_COLUMNS)
    .eq("org_id", session.orgId)
    .eq("tracked", true)
    .eq("muted", false);

  const { count: untrackedCount } = await db
    .from("am_conversations")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.orgId)
    .eq("tracked", false)
    .eq("muted", false);

  // The multi-column select string defeats supabase-js type inference; the
  // client is untyped (SupabaseClient<any>) anyway — assert the row shape.
  type ConvoRow = Record<string, unknown> & {
    last_msg_at: string | null;
    last_inbound_at: string | null;
  };
  const computed = ((rows ?? []) as unknown as ConvoRow[]).map((c) => ({
    ...c,
    ...computeStatus(c as unknown as AmConversationRow, now),
    link: buildLink(c),
  }));
  const visible = computed.filter((c) => c.status !== "hidden");

  const counts = {
    red: visible.filter((c) => c.status === "red").length,
    amber: visible.filter((c) => c.status === "amber").length,
    green: visible.filter((c) => c.status === "green").length,
    untracked: untrackedCount ?? 0,
  };

  if (view === "counts") return Response.json({ counts });

  // Fires first, oldest inbound first inside each bucket; green by recency.
  visible.sort((a, b) => {
    const byStatus =
      STATUS_ORDER[a.status as keyof typeof STATUS_ORDER] -
      STATUS_ORDER[b.status as keyof typeof STATUS_ORDER];
    if (byStatus !== 0) return byStatus;
    if (a.status === "green") {
      return (b.last_msg_at ?? "").localeCompare(a.last_msg_at ?? "");
    }
    return (a.last_inbound_at ?? a.last_msg_at ?? "").localeCompare(
      b.last_inbound_at ?? b.last_msg_at ?? ""
    );
  });

  // Feed liveness — a dead feed must never masquerade as all-green (D6c).
  const { data: sourceRows } = await db.from("am_sources").select("channel, last_heartbeat_at");
  const sources: Record<string, { lastHeartbeatAt: string | null; stale: boolean }> = {
    slack: { lastHeartbeatAt: null, stale: true },
    whatsapp: { lastHeartbeatAt: null, stale: true },
  };
  for (const s of sourceRows ?? []) {
    const at = s.last_heartbeat_at as string | null;
    sources[s.channel as string] = {
      lastHeartbeatAt: at,
      stale: !at || now.getTime() - new Date(at).getTime() > STALE_HEARTBEAT_MS,
    };
  }

  return Response.json({ conversations: visible, counts, sources });
}
