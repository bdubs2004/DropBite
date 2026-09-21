import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // Must stay false on native: there is no window.location to parse, and
        // leaving it on makes session restore silently fail.
        detectSessionInUrl: false,
      },
    });

    // Only auto-refresh the token while the app is in the foreground — the
    // documented Expo setup. Without this, a token can refresh in the
    // background and race the foreground client.
    AppState.addEventListener('change', (state) => {
      if (state === 'active') client!.auth.startAutoRefresh();
      else client!.auth.stopAutoRefresh();
    });
  }
  return client;
}
