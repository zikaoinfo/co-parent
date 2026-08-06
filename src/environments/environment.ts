// Coordonnées du projet Supabase. L'URL et la clé anon sont publiques par
// design (la sécurité vient des policies RLS) : pas de secret ici, jamais.
// Remplacer par les valeurs du projet (Dashboard -> Settings -> API).
export const environment = {
  supabaseUrl: 'https://suswoiteeoqxuixeytpj.supabase.co',
  supabaseAnonKey: 'sb_publishable_lKGR33RpRwrQ7608qcvlsw_p-WUy-lV',
  // Clé publique VAPID (Web Push). La clé privée correspondante est un
  // secret de l'Edge Function (VAPID_KEYS_JWK), jamais dans le repo.
  vapidPublicKey:
    'BOMdpq_LZ9GrYX8pZFko9XprQHLNV5Zz8oaw4bptSHb8yzyi1OhHz1o94m9X9asbmArdTZw-jiNiNdlkwWnKIEc',
};
