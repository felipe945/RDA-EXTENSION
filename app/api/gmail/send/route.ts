import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.access_token) {
    return NextResponse.json({ error: "Not signed in with Google" }, { status: 401 });
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json({ error: "Gmail session expired — sign in again" }, { status: 401 });
  }

  const { to, subject, body, html, leadId, threadId } = await req.json() as {
    to: string;
    subject: string;
    body: string;
    html?: string;
    leadId?: string;
    threadId?: string;
  };

  if (!to || !subject || !body) {
    return NextResponse.json({ error: "Missing to, subject, or body" }, { status: 400 });
  }

  // Build RFC 2822 message. When `html` is provided the message becomes
  // multipart/alternative with `body` as the plain-text fallback; callers that
  // send only `body` get the same single-part message as before.
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
  ];
  if (threadId) lines.push(`In-Reply-To: ${threadId}`, `References: ${threadId}`);
  if (html) {
    const boundary = "=_sales_ops_" + Math.random().toString(36).slice(2);
    lines.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      "",
      body,
      "",
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      "",
      html,
      "",
      `--${boundary}--`,
    );
  } else {
    lines.push(`Content-Type: text/plain; charset=utf-8`, "", body);
  }

  const raw = Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const gmailBody: Record<string, unknown> = { raw };
  if (threadId) gmailBody.threadId = threadId;

  const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(gmailBody),
  });

  if (!gmailRes.ok) {
    const err = await gmailRes.json().catch(() => ({}));
    console.error("[gmail/send] error:", err);
    return NextResponse.json({ error: "Gmail send failed", details: err }, { status: 500 });
  }

  // Store outbound message in DB
  if (leadId) {
    const db = supabaseServer();
    const now = new Date().toISOString();
    await db.from("messages").insert({
      lead_id:      leadId,
      channel:      "email",
      direction:    "outbound",
      body,
      raw:          { to, subject, threadId: threadId ?? null },
      created_at:   now,
    });
    await db.from("leads").update({ last_contact_at: now, updated_at: now }).eq("id", leadId);
  }

  return NextResponse.json({ ok: true });
}
