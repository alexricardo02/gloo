import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Fail-fast validation to ensure environment configurations are properly injected during development
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables. Please check your local .env file.");
}

/**
 * Global Supabase client instance dedicated to managing the WebSocket connection lifecycle.
 * This client handles real-time data replication, connection state retries, and channel multiplexing.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10, // Throttling protection to stabilize visual rendering on high-activity chat loops
    },
  },
});