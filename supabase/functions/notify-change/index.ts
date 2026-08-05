// Edge Function : notifie l'autre parent par e-mail après une modification.
//
// Appelée par le client (fire-and-forget) avec le JWT de l'utilisateur.
// Vérifie l'appartenance à la famille (service role), retrouve l'e-mail de
// l'autre parent et envoie via le SMTP configuré en secrets :
//   npx supabase secrets set SMTP_HOST=... SMTP_PORT=465 SMTP_USER=... \
//     SMTP_PASS=... SMTP_SENDER="Notre Garde <adresse@exemple.fr>"
// Déploiement : npx supabase functions deploy notify-change

import { createClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
      },
    });
  }

  try {
    // Identité de l'appelant, via son propre JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const asCaller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await asCaller.auth.getUser();
    if (!user) return json({ error: 'Authentification requise' }, 401);

    const { family_id, message } = await req.json();
    if (typeof family_id !== 'string' || typeof message !== 'string' || !message.trim()) {
      return json({ error: 'Requête invalide' }, 400);
    }
    if (message.length > 500) return json({ error: 'Message trop long' }, 400);

    // Vérification d'appartenance + destinataire, avec le service role.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: members, error: membersError } = await admin
      .from('family_members')
      .select('user_id')
      .eq('family_id', family_id);
    if (membersError) return json({ error: 'Lecture des membres impossible' }, 500);
    if (!members?.some((m) => m.user_id === user.id)) {
      return json({ error: 'Accès refusé' }, 403);
    }
    const other = members.find((m) => m.user_id !== user.id);
    if (!other) return json({ sent: false, reason: 'famille incomplète' });

    const { data: otherUser, error: userError } = await admin.auth.admin.getUserById(
      other.user_id,
    );
    const to = otherUser?.user?.email;
    if (userError || !to) return json({ sent: false, reason: 'destinataire introuvable' });

    const host = Deno.env.get('SMTP_HOST');
    const smtpUser = Deno.env.get('SMTP_USER');
    const pass = Deno.env.get('SMTP_PASS');
    if (!host || !smtpUser || !pass) {
      return json({ sent: false, reason: 'SMTP non configuré' });
    }

    const client = new SMTPClient({
      connection: {
        hostname: host,
        port: Number(Deno.env.get('SMTP_PORT') ?? '465'),
        tls: true,
        auth: { username: smtpUser, password: pass },
      },
    });
    try {
      await client.send({
        from: Deno.env.get('SMTP_SENDER') ?? smtpUser,
        to,
        subject: 'Notre Garde — le calendrier a été modifié',
        content: `${message}\n\nOuvrez l'application pour voir le détail.`,
      });
    } finally {
      await client.close();
    }

    return json({ sent: true });
  } catch (error) {
    console.error(error);
    return json({ error: 'Erreur interne' }, 500);
  }
});
