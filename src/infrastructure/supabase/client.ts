import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface RuntimeConfiguration {
  supabaseUrl: string
  supabasePublishableKey: string
}

export function loadRuntimeConfiguration(): RuntimeConfiguration | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !supabasePublishableKey) return null
  return { supabaseUrl, supabasePublishableKey }
}

export function createSupabaseClient(configuration: RuntimeConfiguration): SupabaseClient {
  return createClient(configuration.supabaseUrl, configuration.supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  })
}
