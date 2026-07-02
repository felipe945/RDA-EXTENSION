import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { canManageTeam } from "@/lib/permissions";
import { getBaseUrl } from "@/lib/base-url";
import { buildInviteEmail } from "@/lib/invite-email";

export async function GET() {
  const session = await getServerSession(authOptions);
  // Fail-closed: no org or no manage-team role → deny.
  if (!session?.orgId || !canManageTeam(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseServer();
  const { data, error } = await db.from("invites").select("*").eq("org_id", session.orgId).order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ invites: data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canManageTeam(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { email, role } = await req.json() as { email?: string; role?: string };
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const db = supabaseServer();
  const { data: invite, error } = await db
    .from("invites")
    .insert({ org_id: session.orgId, email, role: role ?? "rep", invited_by: session.userId })
    .select("token, role, expires_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Reuse the existing Gmail-send route — do not build a second email system.
  // Forward the inviter's session cookie so gmail/send can authenticate as them
  // (it gates on session.access_token, which only exists on the cookie's session).
  const inviteUrl = `${getBaseUrl()}/login?invite=${invite!.token}`;
  const { subject, text, html } = buildInviteEmail({
    inviterName: session.user?.name ?? session.user?.email ?? "A teammate",
    role: invite!.role,
    email,
    inviteUrl,
    expiresAt: invite!.expires_at,
  });
  let emailSent = false;
  try {
    const res = await fetch(`${getBaseUrl()}/api/gmail/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ to: email, subject, body: text, html }),
    });
    emailSent = res.ok;
  } catch {
    // Gmail send may fail (expired OAuth, no Gmail scope). The invite row still
    // exists — TEAM-T2's settings UI surfaces inviteUrl so Felipe can copy/paste
    // it as a fallback.
  }

  return Response.json({ ok: true, inviteUrl, emailSent });
}
