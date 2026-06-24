import { type NextRequest } from "next/server";
import { createHash } from "crypto";
import { supabaseServer } from "@/lib/supabase";

// POST /api/sendblue  — inbound SMS webhook from SendBlue
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Verify signature: sha256(body + secret)
  const signature = request.headers.get("x-sendblue-signature");
  const secret = process.env.SENDBLUE_API_SECRET ?? "";
  const expected = createHash("sha256")
    .update(rawBody + secret)
    .digest("hex");

  if (!signature || signature !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const senderPhone = (body.from_number ?? body.phone_number ?? body.from) as string | undefined;
  const messageBody = (body.content ?? body.message ?? body.body) as string | undefined;

  if (!senderPhone) {
    return Response.json({ error: "Missing sender phone" }, { status: 400 });
  }

  const db = supabaseServer();
  const now = new Date().toISOString();

  // Find or create lead by phone number
  const { data: existing } = await db
    .from("leads")
    .select("id")
    .eq("phone", senderPhone)
    .single();

  let leadId: string;

  if (existing) {
    leadId = existing.id as string;
  } else {
    const { data: newLead, error: insertError } = await db
      .from("leads")
      .insert({
        phone: senderPhone,
        name: senderPhone,
        source: "SMS",
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
    channel: "sms",
    direction: "inbound",
    body: messageBody ?? null,
    raw: body,
    created_at: now,
  });

  if (msgError) {
    console.error("[sendblue] message insert error:", msgError.message);
  }

  // Update last_contact_at on lead
  await db
    .from("leads")
    .update({ last_contact_at: now, updated_at: now })
    .eq("id", leadId);

  return Response.json({ ok: true });
}
