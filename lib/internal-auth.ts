// Shared internal-caller gate for server-to-server routes (Vercel Cron, the
// research drain/trigger, CLI scripts). The caller proves itself with
// `Authorization: Bearer $CRON_SECRET`.
import { type NextRequest } from "next/server";

// Fails CLOSED: unset secret → nobody passes (never `if (SECRET && ...)` — that's H1).
export function hasInternalSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return token.length === secret.length && token === secret;
}
