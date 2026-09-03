import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Server-side Supabase client authenticated with the service role key.
 *
 * This bypasses Row Level Security, so every query built on top of it MUST
 * filter explicitly by `tenant_id` to preserve multi-tenant isolation — see
 * the MCP tool implementations in `src/mcp/` for the pattern to follow.
 */
export const supabaseAdmin: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
