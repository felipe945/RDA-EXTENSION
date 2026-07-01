import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const db = supabaseServer();
  const { searchParams } = request.nextUrl;
  const leadId = searchParams.get("lead_id");
  const limit = Math.min(parseInt(searchParams.get("limit") || "5", 10), 20);

  if (!leadId) {
    return Response.json({ error: "lead_id required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("messages")
    .select("id, lead_id, channel, direction, body, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ messages: data ?? [] });
}

export async function POST(request: NextRequest) {
  const db = supabaseServer();

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { error, data } = await db.from("messages").insert(body).select().single();

  if (error) {
    // messages table may not have the column — log but don't crash outreach flow
    console.error("[messages] insert error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ message: data }, { status: 201 });
}
