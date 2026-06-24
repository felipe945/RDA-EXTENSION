import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";

interface GmailWebhookBody {
  from: string;
  subject: string;
  body: string;
  threadId: string;
}

// POST /api/gmail  — inbound Gmail reply webhook
export async function POST(request: NextRequest) {
  let body: GmailWebhookBody;
  try {
    body = await request.json() as GmailWebhookBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { from, subject, body: messageBody, threadId } = body;

  if (!from) {
    return Response.json({ error: "Missing from address" }, { status: 400 });
  }

  // Extract plain email address from "Name <email@domain.com>" format
  const emailMatch = from.match(/<([^>]+)>/) ?? from.match(/([^\s]+@[^\s]+)/);
  const email = emailMatch ? emailMatch[1] : from;

  const db = supabaseServer();
  const now = new Date().toISOString();

  // Match lead by email
  const { data: existing } = await db
    .from("leads")
    .select("id")
    .eq("email", email)
    .single();

  let leadId: string;

  if (existing) {
    leadId = existing.id as string;
  } else {
    // Create new lead from email if not found
    const { data: newLead, error: insertError } = await db
      .from("leads")
      .insert({
        email,
        name: email,
        source: "Email",
        mode: "sales",
        stage: "New",
        updated_at: now,
      })
      .select("id")
      .single();

    if (insertError || !newLead) {
      return Response.json({ error: "Failed to create lead" }, { status: 500 });
    }

    leadId = newLead.id as string;
  }

  // Insert message record
  const { error: msgError } = await db.from("messages").insert({
    lead_id: leadId,
    channel: "email",
    direction: "inbound",
    body: messageBody ?? null,
    raw: { from, subject, threadId },
    created_at: now,
  });

  if (msgError) {
    console.error("[gmail] message insert error:", msgError.message);
  }

  // Update last_contact_at on lead
  await db
    .from("leads")
    .update({ last_contact_at: now, updated_at: now })
    .eq("id", leadId);

  return Response.json({ ok: true });
}
