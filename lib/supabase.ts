// Server-only Supabase access. The browser anon client that used to live here
// is gone (data-C1): migration 020 enables RLS with no policies + revokes anon
// on leads/messages, so the anon key reads nothing — and no client code imports
// it anymore (inbox + hooks go through /api/*). Removing the export also keeps
// NEXT_PUBLIC_SUPABASE_ANON_KEY out of the client bundle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient<any>;

function getUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

export function supabaseServer(): DB {
  return createClient(getUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") as DB;
}
