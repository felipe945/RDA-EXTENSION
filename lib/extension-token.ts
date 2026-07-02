// repToken — the extension's long-lived credential, minted by
// /api/extension/auth/start after a normal NextAuth Google sign-in.
// HS256 JWT: { sub: rep_id, email, name, team_id, ver, iss: "fbsalesops", exp: +90d }.
// `ver` is compared against users.extension_token_version on every verify, so
// bumping that column revokes every token a rep has ever been issued.
import { SignJWT, jwtVerify } from "jose";
import { supabaseServer } from "@/lib/supabase";

const ISSUER = "fbsalesops";
const TOKEN_TTL_S = 90 * 24 * 60 * 60; // 90 days

export interface RepIdentity {
  rep_id: string;
  email: string;
  name: string | null;
  team_id: string | null;
}

function secretKey(): Uint8Array {
  const secret = process.env.EXTENSION_TOKEN_SECRET;
  if (!secret) throw new Error("EXTENSION_TOKEN_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function mintRepToken(rep: {
  id: string;
  email: string;
  name?: string | null;
  team_id?: string | null;
  extension_token_version?: number | null;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: rep.email,
    name: rep.name ?? null,
    team_id: rep.team_id ?? null,
    ver: rep.extension_token_version ?? 1,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(rep.id)
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_S)
    .sign(secretKey());
}

// Accepts the raw Authorization header ("Bearer <jwt>"). Returns the rep's
// identity, or null for anything invalid — missing header, bad signature,
// expired, unknown rep, or a `ver` that no longer matches the users row.
export async function verifyRepToken(authHeader: string | null): Promise<RepIdentity | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;

    // select * — tolerates the window before migration 014 adds
    // extension_token_version (missing column reads as undefined → 1).
    const db = supabaseServer();
    const { data: u } = await db
      .from("users")
      .select("*")
      .eq("id", payload.sub)
      .maybeSingle();
    if (!u) return null;
    if (((u.extension_token_version as number) ?? 1) !== ((payload.ver as number) ?? 1)) return null;

    return {
      rep_id: payload.sub,
      email: (payload.email as string) ?? "",
      name: (payload.name as string) ?? null,
      team_id: (payload.team_id as string) ?? null,
    };
  } catch {
    return null;
  }
}
