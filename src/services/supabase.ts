import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client — login/logout/session + JWT token kaynağı.
 * Service role key BURAYA ASLA gelmez (sadece anon/publishable).
 *
 * Session localStorage'da persist edilir; sayfa yenilense de oturum kalır.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // App boot'unda LookupGate öncesi ekrana yansır — login sayfası bile açılmaz
  console.error(
    '[supabase] VITE_SUPABASE_URL veya VITE_SUPABASE_ANON_KEY tanımlı değil. .env dosyanı kontrol et.',
  );
}

export const supabase: SupabaseClient = createClient(url ?? '', anon ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // OAuth callback için
  },
});

/** apiFetch için: aktif access token'ı döner. Yoksa null. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
