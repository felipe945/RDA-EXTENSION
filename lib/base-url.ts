// Single source of truth for the app's own origin, used by server-side code that
// needs to call back into its own routes (research trigger, invite links, etc.).
// Order: explicit override → Vercel-injected host → NextAuth URL → local dev.
export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  );
}
