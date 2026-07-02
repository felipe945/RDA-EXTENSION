import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";

// GET /api/invites/preview?token=<uuid> — public invite lookup for the login
// page, so an invited teammate is greeted by name instead of a generic sign-in.
// Deliberately session-free (the visitor isn't signed in yet) and allowlisted
// in proxy.ts: possession of the uuid token — delivered by email — is the
// credential, and the response contains only what that email already said.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return Response.json({ error: "token required" }, { status: 400 });

  const db = supabaseServer();
  // A malformed token makes Postgres reject the uuid cast — treat as not found.
  const { data: invite, error } = await db
    .from("invites")
    .select("email, role, expires_at, accepted_at, invited_by")
    .eq("token", token)
    .maybeSingle();
  if (error || !invite) return Response.json({ error: "not found" }, { status: 404 });

  let inviter: string | null = null;
  if (invite.invited_by) {
    const { data: u } = await db
      .from("users")
      .select("name, email")
      .eq("id", invite.invited_by)
      .maybeSingle();
    inviter = u?.name ?? u?.email ?? null;
  }

  const status = invite.accepted_at
    ? "accepted"
    : new Date(invite.expires_at).getTime() < Date.now()
      ? "expired"
      : "pending";

  return Response.json({
    inviter,
    role: invite.role,
    email: invite.email,
    expiresAt: invite.expires_at,
    status,
  });
}
