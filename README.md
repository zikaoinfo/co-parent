# Notre Garde

Application web mobile-first utilisée par **exactement deux parents séparés**
pour gérer le calendrier de garde de leurs enfants : rythme récurrent
(semaines alternées, 2-2-3 ou manuel), échanges ponctuels de jours,
événements (médecin, école…), passations (jour, heure, qui vient chercher)
et notes de passation. Les deux parents voient et modifient les mêmes données
**en temps réel**.

Stack : Angular 22 (standalone, zoneless, signals), CSS custom,
Supabase (Postgres + Auth magic link + Realtime). Seule dépendance runtime
ajoutée : `@supabase/supabase-js`.

## Mise en service (propriétaire)

### 1. Projet Supabase

1. Créer un projet sur [supabase.com](https://supabase.com) — région **EU
   (Frankfurt ou Paris)** pour le RGPD.
2. Lier le repo et pousser les migrations :

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-du-projet>
   npx supabase db push
   ```

3. Dashboard → **Authentication** :
   - Sign In / Up : garder uniquement **Email** ; désactiver « Enable email
     confirmations » n'est pas nécessaire — le magic link est le seul mode
     (pas de mot de passe).
   - **URL Configuration** : renseigner la Site URL (l'URL GitHub Pages) et
     l'ajouter aux Redirect URLs (avec `/**`).
4. Dashboard → Settings → API : copier l'URL du projet et la clé **anon**
   dans `src/environments/environment.ts`. Ces deux valeurs sont publiques
   par design — la sécurité vient des policies RLS. Ne jamais mettre la clé
   `service_role` dans le code.

### 2. GitHub Pages

1. Settings du repo → **Pages** → Source : **GitHub Actions**.
2. `.github/workflows/deploy.yml` tourne sur **`main` et sur toute pull
   request visant `main`** : tests unitaires puis build avec
   `--base-href=/co-parent/`. Une fusion proposée est donc vérifiée avant
   d'être fusionnée ; la publication sur Pages, elle, n'a lieu qu'au push
   sur `main`.
   L'app est servie sur `https://<utilisateur>.github.io/co-parent/` —
   c'est cette URL qu'il faut mettre en Site URL côté Supabase.
3. L'app est installable (PWA) depuis Safari iOS (« Sur l'écran
   d'accueil ») et Chrome Android ; la lecture fonctionne hors ligne.

### 3. Onboarding des parents

1. Parent 1 : ouvrir l'app, se connecter par magic link, remplir le wizard —
   la famille est créée et un **lien d'invitation** s'affiche.
2. Envoyer ce lien (`/join/<token>`, valable 7 jours, usage unique) au
   parent 2, qui se connecte par magic link puis rejoint automatiquement.
3. **Une fois les deux parents inscrits** : Dashboard → Authentication →
   Sign ups → **désactiver les inscriptions**. L'app devient un mur pour
   tout visiteur de l'URL publique ; les deux comptes existants continuent
   de se connecter normalement.

## E-mails : magic links + notifications de modification

Deux usages, un seul SMTP. Recommandation : une boîte dédiée (compte Google
à part avec mot de passe d'application, ou une adresse de votre domaine).

1. **Magic links** (connexion) : Dashboard → Authentication → Emails →
   **SMTP Settings** → Enable custom SMTP (host/port 465/utilisateur/mot de
   passe de la boîte, sender `Notre Garde <adresse>`), puis Authentication →
   **Rate Limits** : monter la limite d'envoi (ex. 30/h). Sans SMTP custom,
   l'e-mail intégré de Supabase est limité à ~2 envois/heure.
2. **Notification à l'autre parent à chaque modification** (échange de jour,
   événement, note, réglages) : l'app appelle l'Edge Function
   `notify-change`, qui envoie l'e-mail via le même SMTP. Mise en service :

   ```bash
   npx supabase secrets set \
     SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
     SMTP_USER=adresse@gmail.com SMTP_PASS='mot-de-passe-application' \
     SMTP_SENDER='Notre Garde <adresse@gmail.com>'
   npx supabase functions deploy notify-change
   ```

   Le réglage « Prévenir l'autre parent par e-mail » (écran Réglages)
   active/désactive ces envois pour la famille. L'envoi est en
   fire-and-forget : un échec SMTP ne bloque jamais la modification.

3. **Notifications d'application (push)** : chaque parent peut activer les
   notifications sur chacun de ses appareils (Réglages → « Notifications
   sur cet appareil »). Sur iPhone/iPad : installer d'abord la PWA sur
   l'écran d'accueil (iOS 16.4+). Côté serveur, la même Edge Function
   pousse vers les appareils abonnés de l'autre parent ; il faut lui
   fournir la clé privée VAPID (la clé publique est dans
   `src/environments/environment.ts`) :

   ```bash
   npx supabase secrets set \
     VAPID_KEYS_JWK='<paire de clés JWK, voir ci-dessous>' \
     VAPID_SUBJECT='mailto:adresse@exemple.fr'
   npx supabase functions deploy notify-change
   ```

   Pour régénérer une paire (invalide les abonnements existants) :
   `node -e` avec `crypto.generateKeyPairSync('ec', {namedCurve:'prime256v1'})`
   — exporter public/privé en JWK et reporter la clé publique
   (`applicationServerKey` base64url) dans `environment.ts`.

## Vacances scolaires

Les dates officielles (métropole, zones A/B/C) sont embarquées dans
`src/app/core/holidays.ts` — années 2025-2026 et 2026-2027 (arrêté JO
d'octobre 2025). **À compléter chaque année** depuis
[education.gouv.fr](https://www.education.gouv.fr/calendrier-scolaire) en
ajoutant les périodes au tableau `SCHOOL_HOLIDAYS_FR`. Le partage
moitié-moitié (option des réglages) attribue la première moitié de chaque
période au parent configuré les années paires, à l'autre les années
impaires ; les échanges ponctuels restent prioritaires.

## Passations

Écran Réglages (ou wizard de création) → **Passations** : on y programme, pour
chaque semaine, le jour et l'heure où l'enfant change de maison, et qui vient
le chercher — un parent fixe, ou « le parent qui prend la garde » (résolu
automatiquement, échanges ponctuels et partage des vacances compris). Plusieurs
passations sont possibles (utile en 2-2-3). Les jours concernés portent un 🚗
dans la grille ; le détail (« 18:00 — Alice vient chercher Léa ») s'affiche dans
le panneau du jour.

La passation **cale le cycle de garde** : avec les rythmes hebdomadaires
(« semaines alternées » et « semaines paires / impaires »), la bascule a lieu à
la première passation de la semaine, pas le lundi à minuit. Configurer une
passation le vendredi fait donc courir la semaine de garde du vendredi au
vendredi — le week-end reste chez le parent qui a récupéré l'enfant. Le 2-2-3
n'est pas décalé : ses transitions sont déjà portées par son pattern de
14 jours.

Le jour de la bascule est **partagé entre les deux parents** : la case du
calendrier est coupée au prorata de l'heure (passation à midi = moitié-moitié,
à 18:00 = trois quarts / un quart), la part gauche revenant au parent du matin.
`custodianFor` continue de désigner le gardien de la nuit ; `daySplit` donne le
détail intra-journalier.

## Version déployée

Le numéro de version est dérivé de git par `scripts/build-info.mjs` : c'est le
**nombre de commits** de la branche construite, donc il augmente à chaque
fusion sur `main`. Le script est lancé automatiquement par npm (`postinstall`,
`prestart`, `prebuild`) et produit deux fichiers, non versionnés :

- `src/environments/build-info.ts` — affiché dans **Réglages → Version**
  (« Version 42 — commit `a1b2c3d` du 22 août 2026 ») ;
- `public/version.json` — copié à la racine du site, pour vérifier ce qui est
  en ligne sans ouvrir l'app :

  ```bash
  curl -s https://<utilisateur>.github.io/co-parent/version.json
  ```

  Ce fichier n'est pas mis en cache par le service worker : il reflète toujours
  le dernier déploiement, même si un onglet ouvert affiche encore l'ancienne
  version en attendant la mise à jour du service worker.

Le workflow fait donc un `checkout` avec `fetch-depth: 0` — sans l'historique
complet, le décompte des commits serait faux.


## Développement

```bash
npm ci
npm start                      # serveur de dev
npm test                       # tests unitaires (Vitest)
supabase/tests/run-local.sh    # tests des migrations + policies RLS
                               # (PostgreSQL >= 15 requis, pas de Docker)
```

Le script `run-local.sh` monte un cluster Postgres jetable, rejoue le shim
Supabase (`auth.uid()`, rôles anon/authenticated), applique les migrations
et déroule ~45 vérifications : étanchéité entre familles, `with check` sur
les écritures, tokens d'invitation utilisés/expirés, refus des écritures
directes sur `family_members`/`invitations`.

## Sécurité — résumé

- RLS activée sur **toutes** les tables ; chaque policy d'écriture porte un
  `with check (is_member(family_id))`.
- `family_members` et `invitations` ne s'écrivent que via les RPC
  `security definer` : `create_family`, `join_family`,
  `regenerate_invitation`.
- Auth par magic link uniquement ; inscriptions à désactiver après
  l'onboarding (voir ci-dessus).
- Aucune donnée envoyée à un tiers hors Supabase ; pas d'analytics.

## Hors ligne

Lecture : le dernier état connu est mis en cache (localStorage) et l'app
s'ouvre instantanément. Écriture : non supportée hors ligne — les boutons
sont désactivés avec un bandeau « Hors ligne ».
