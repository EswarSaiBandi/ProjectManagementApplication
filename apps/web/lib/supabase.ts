import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createBrowserClient(supabaseUrl, supabaseKey);

export function getSupabaseClient() {
  if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase environment variables are not set');
    return null;
  }
  return supabase;
}
