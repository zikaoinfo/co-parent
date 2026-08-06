// Edge Function : notifie l'autre parent après une modification.
// - Push Web (notification d'application) vers ses appareils abonnés,
// - E-mail si la famille l'a activé (réglage notifyByEmail).
//
// Appelée par le client (fire-and-forget) avec le JWT de l'utilisateur.
// Secrets attendus :
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SENDER   (e-mail)
//   VAPID_KEYS_JWK ({"publicKey":{...},"privateKey":{...}})       (push)
//   VAPID_SUBJECT (mailto:adresse@exemple.fr)
// Déploiement : npx supabase functions deploy notify-change

import { createClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import * as webpush from 'jsr:@negrel/webpush@0.3.0';

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

    const result = { push: 0, email: false };

    // ——— Push Web vers les appareils abonnés de l'autre parent ———
    const vapidJwk = Deno.env.get('VAPID_KEYS_JWK');
    if (vapidJwk) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', other.user_id);
      if (subs?.length) {
        const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidJwk), {
          extractable: false,
        });
        const appServer = await webpush.ApplicationServer.new({
          contactInformation: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
          vapidKeys,
        });
        // Payload au format attendu par le service worker Angular (ngsw).
        const payload = JSON.stringify({
          notification: {
            title: 'Notre Garde',
            body: message,
            icon: 'icons/icon-192x192.png',
            badge: 'icons/icon-72x72.png',
            lang: 'fr',
            tag: 'notre-garde',
            data: {
              onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '/' } },
            },
          },
        });
        for (const sub of subs) {
          try {
            const subscriber = appServer.subscribe({
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            });
            await subscriber.pushTextMessage(payload, {});
            result.push++;
          } catch (error) {
            // Abonnement expiré/révoqué : on le retire.
            const status = (error as { response?: { status?: number } })?.response?.status;
            if (status === 404 || status === 410) {
              await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            }
          }
        }
      }
    }

    // ——— E-mail, si la famille l'a activé ———
    const { data: family } = await admin
      .from('families')
      .select('config')
      .eq('id', family_id)
      .single();
    const emailWanted = family?.config?.notifyByEmail !== false;
    const host = Deno.env.get('SMTP_HOST');
    const smtpUser = Deno.env.get('SMTP_USER');
    const pass = Deno.env.get('SMTP_PASS');
    if (emailWanted && host && smtpUser && pass) {
      const { data: otherUser } = await admin.auth.admin.getUserById(other.user_id);
      const to = otherUser?.user?.email;
      if (to) {
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
          result.email = true;
        } finally {
          await client.close();
        }
      }
    }

    return json({ sent: true, ...result });
  } catch (error) {
    console.error(error);
    return json({ error: 'Erreur interne' }, 500);
  }
});
