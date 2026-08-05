import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

// Flux implicite : le magic link reste utilisable même ouvert dans un autre
// navigateur que celui qui l'a demandé (PKCE l'interdirait), cas fréquent sur
// mobile où l'app mail ouvre son propre navigateur.
export const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
  auth: {
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
