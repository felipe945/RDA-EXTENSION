// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient<any>;

function getUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

let _client: DB | null = null;
export function supabase(): DB {
  if (!_client) _client = createClient(getUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "") as DB;
  return _client;
}

export function supabaseServer(): DB {
  return createClient(getUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") as DB;
}
