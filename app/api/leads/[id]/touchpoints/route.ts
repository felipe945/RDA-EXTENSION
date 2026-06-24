import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

// POST — log a new touchpoint
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json() as { channel?: string; result?: string; note?: string };
  const { channel, result = "sent", note } = body;

  if (!channel) return NextResponse.json({ error: "Missing channel" }, { status: 400 });

  const db = supabaseServer();

  const { data: lead, error: fetchErr } = await db
    .from("leads")
    .select("outreach_log")
    .eq("id", id)
    .single();

  if (fetchErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const existing = (lead.outreach_log as unknown[]) ?? [];
  const entry = {
    id:       crypto.randomUUID(),
    channel,
    result,
    note:     note ?? null,
    tried_at: new Date().toISOString(),
  };

  const { error: updateErr } = await db
    .from("leads")
    .update({
      outreach_log:    [...existing, entry],
      last_contact_at: entry.tried_at,
      updated_at:      entry.tried_at,
    })
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, entry });
}

// PATCH — update result or note on an existing touchpoint
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json() as { touchpointId?: string; result?: string; note?: string };
  const { touchpointId, result, note } = body;

  if (!touchpointId) return NextResponse.json({ error: "Missing touchpointId" }, { status: 400 });

  const db = supabaseServer();

  const { data: lead } = await db.from("leads").select("outreach_log").eq("id", id).single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const log = (lead.outreach_log as Record<string, unknown>[]) ?? [];
  const updated = log.map((e) =>
    e.id === touchpointId
      ? { ...e, ...(result !== undefined ? { result } : {}), ...(note !== undefined ? { note } : {}) }
      : e
  );

  await db
    .from("leads")
    .update({ outreach_log: updated, updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
