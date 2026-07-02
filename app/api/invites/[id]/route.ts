import { type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { canManageTeam } from "@/lib/permissions";
import { getBaseUrl } from "@/lib/base-url";
import { buildInviteEmail } from "@/lib/invite-email";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/invites/[id] — revoke an invite (admin-only). The row is removed
// outright so the emailed link dies immediately: the login preview 404s and
// the signIn gate in lib/auth.ts finds no invite.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canManageTeam(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseServer();
  const { error } = await db
    .from("invites")
    .delete()
    .eq("id", id)
    .eq("org_id", session.orgId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// POST /api/invites/[id] — resend an invite (admin-only): extend the expiry by
// 7 days from now and re-email the branded invitation. Accepted invites can't
// be resent; expired ones can (resending is how an admin revives them).
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canManageTeam(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseServer();
  const newExpiry = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const { data: invite, error } = await db
    .from("invites")
    .update({ expires_at: newExpiry })
    .eq("id", id)
    .eq("org_id", session.orgId)
    .is("accepted_at", null)
    .select("email, role, token, expires_at")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!invite) return Response.json({ error: "Invite not found or already accepted" }, { status: 404 });

  // Same cookie-forwarding pattern as POST /api/invites — gmail/send
  // authenticates as the admin doing the resend.
  const inviteUrl = `${getBaseUrl()}/login?invite=${invite.token}`;
  const { subject, text, html } = buildInviteEmail({
    inviterName: session.user?.name ?? session.user?.email ?? "A teammate",
    role: invite.role,
    email: invite.email,
    inviteUrl,
    expiresAt: invite.expires_at,
  });
  let emailSent = false;
  try {
    const res = await fetch(`${getBaseUrl()}/api/gmail/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ to: invite.email, subject, body: text, html }),
    });
    emailSent = res.ok;
  } catch {
    // Email failure isn't fatal — the UI copies inviteUrl as a DM fallback.
  }

  return Response.json({ ok: true, inviteUrl, emailSent });
}
