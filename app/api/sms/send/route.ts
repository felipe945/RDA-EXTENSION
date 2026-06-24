import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const body = await req.json() as { to?: string; message?: string; leadId?: string };
  const { to, message, leadId } = body;

  if (!to || !message) {
    return NextResponse.json({ error: "Missing to or message" }, { status: 400 });
  }

  const apiKey    = process.env.SENDBLUE_API_KEY;
  const apiSecret = process.env.SENDBLUE_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: "SendBlue not configured" }, { status: 503 });
  }

  const sbRes = await fetch("https://api.sendblue.co/api/send-message", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "sb-api-key-id":     apiKey,
      "sb-api-secret-key": apiSecret,
    },
    body: JSON.stringify({ number: to, content: message }),
  });

  if (!sbRes.ok) {
    const err = await sbRes.text();
    return NextResponse.json({ error: `SendBlue: ${err}` }, { status: 502 });
  }

  if (leadId) {
    const db = supabaseServer();
    const now = new Date().toISOString();
    await db.from("messages").insert({
      lead_id:    leadId,
      channel:    "sms",
      direction:  "outbound",
      body:       message,
      raw:        { to },
      created_at: now,
    });
    await db.from("leads").update({ last_contact_at: now, updated_at: now }).eq("id", leadId);
  }

  return NextResponse.json({ ok: true });
}
