# Notre Garde

Application web mobile-first utilisée par **exactement deux parents séparés**
pour gérer le calendrier de garde de leurs enfants : rythme récurrent
(semaines alternées, 2-2-3 ou manuel), échanges ponctuels de jours,
événements (médecin, école…) et notes de passation. Les deux parents voient
et modifient les mêmes données **en temps réel**.

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
2. Chaque push sur `main` déclenche `.github/workflows/deploy.yml`
   (tests, build avec `--base-href=/co-parent/`, publication).
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
