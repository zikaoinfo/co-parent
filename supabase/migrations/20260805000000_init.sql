-- Notre Garde — schéma initial : tables, RLS, RPC, realtime.
--
-- Modèle de sécurité : chaque famille compte au plus 2 parents
-- (family_members, parent_index unique). Toutes les tables sont sous RLS ;
-- l'adhésion (family_members) et les invitations ne s'écrivent JAMAIS
-- directement depuis le client, uniquement via les fonctions security definer
-- create_family / join_family / regenerate_invitation.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table families (
  id uuid primary key default gen_random_uuid(),
  config jsonb not null,                -- FamilyConfig (voir src/app/core/custody.ts)
  created_at timestamptz default now()
);

create table family_members (
  family_id uuid references families on delete cascade,
  user_id uuid references auth.users on delete cascade,
  parent_index smallint not null check (parent_index in (0, 1)),
  primary key (family_id, user_id),
  unique (family_id, parent_index)      -- max 2 parents, index unique
);

create table invitations (
  token uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  parent_index smallint not null check (parent_index in (0, 1)),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz
);

create table custody_overrides (
  family_id uuid references families on delete cascade,
  day date not null,
  parent_index smallint not null check (parent_index in (0, 1)),
  updated_by uuid references auth.users,
  updated_at timestamptz default now(),
  primary key (family_id, day)
);

create table events (
  id bigint generated always as identity primary key,
  family_id uuid not null references families on delete cascade,
  day date not null,
  title text not null check (char_length(title) between 1 and 200),
  time text check (time is null or time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

create index events_family_day on events (family_id, day);

create table day_notes (
  family_id uuid references families on delete cascade,
  day date not null,
  note text not null check (char_length(note) <= 2000),
  updated_by uuid references auth.users,
  updated_at timestamptz default now(),
  primary key (family_id, day)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table families enable row level security;
alter table family_members enable row level security;
alter table invitations enable row level security;
alter table custody_overrides enable row level security;
alter table events enable row level security;
alter table day_notes enable row level security;

-- Helper : l'utilisateur courant est-il membre de la famille ?
-- security definer pour lire family_members sans être bloqué par sa propre RLS.
create function is_member(fid uuid) returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from family_members
    where family_id = fid and user_id = (select auth.uid())
  );
$$;

-- anon garde l'exécution : sans session auth.uid() est null, is_member
-- retourne false et les policies filtrent tout — un select anon rend 0 ligne
-- au lieu d'une erreur de permission.
revoke execute on function is_member(uuid) from public;
grant execute on function is_member(uuid) to anon, authenticated;

-- families : lecture/édition par les membres. Pas de policy insert : la
-- création passe exclusivement par create_family (security definer). Pas de
-- policy delete : la suppression d'une famille est une opération d'admin
-- (dashboard), pas un geste de l'app.
create policy families_select on families for select
  using (is_member(id));
create policy families_update on families for update
  using (is_member(id)) with check (is_member(id));

-- family_members : chacun ne voit que ses propres adhésions. AUCUNE policy
-- d'écriture : insert uniquement via create_family / join_family.
create policy family_members_select on family_members for select
  using (user_id = (select auth.uid()));

-- invitations : aucune policy — table manipulée uniquement en security definer.

-- custody_overrides / events / day_notes : les 4 opérations, chacune limitée
-- aux membres. Le with check sur les écritures est indispensable : sans lui,
-- n'importe quel utilisateur authentifié pourrait insérer des lignes pointant
-- vers notre famille.
create policy custody_overrides_select on custody_overrides for select
  using (is_member(family_id));
create policy custody_overrides_insert on custody_overrides for insert
  with check (is_member(family_id));
create policy custody_overrides_update on custody_overrides for update
  using (is_member(family_id)) with check (is_member(family_id));
create policy custody_overrides_delete on custody_overrides for delete
  using (is_member(family_id));

create policy events_select on events for select
  using (is_member(family_id));
create policy events_insert on events for insert
  with check (is_member(family_id));
create policy events_update on events for update
  using (is_member(family_id)) with check (is_member(family_id));
create policy events_delete on events for delete
  using (is_member(family_id));

create policy day_notes_select on day_notes for select
  using (is_member(family_id));
create policy day_notes_insert on day_notes for insert
  with check (is_member(family_id));
create policy day_notes_update on day_notes for update
  using (is_member(family_id)) with check (is_member(family_id));
create policy day_notes_delete on day_notes for delete
  using (is_member(family_id));

-- ---------------------------------------------------------------------------
-- RPC (security definer) — seul chemin d'écriture vers family_members /
-- invitations
-- ---------------------------------------------------------------------------

-- Parent 1 : crée la famille, son adhésion (index 0) et le token
-- d'invitation du parent 2.
create function create_family(config jsonb)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  fid uuid;
  tok uuid;
begin
  if uid is null then
    raise exception 'Authentification requise';
  end if;
  if jsonb_typeof(config->'parents') is distinct from 'array'
     or jsonb_array_length(config->'parents') <> 2 then
    raise exception 'Config invalide : exactement deux parents requis';
  end if;
  if jsonb_typeof(config->'children') is distinct from 'array'
     or jsonb_array_length(config->'children') < 1 then
    raise exception 'Config invalide : au moins un enfant requis';
  end if;
  if config->'rotation'->>'type' not in ('week', '223', 'manual')
     or (config->'rotation'->>'anchor') !~ '^\d{4}-\d{2}-\d{2}$'
     or (config->'rotation'->>'start') not in ('0', '1') then
    raise exception 'Config invalide : rotation malformée';
  end if;

  insert into families (config) values (config) returning id into fid;
  insert into family_members (family_id, user_id, parent_index)
    values (fid, uid, 0);
  insert into invitations (family_id, parent_index)
    values (fid, 1) returning token into tok;

  return json_build_object('family_id', fid, 'invite_token', tok);
end;
$$;

-- Parent 2 : rejoint via le token. Vérifie non utilisé / non expiré, marque
-- used_at. Idempotent si l'utilisateur est déjà membre de cette famille.
create function join_family(invite_token uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv record;
begin
  if uid is null then
    raise exception 'Authentification requise';
  end if;

  select * into inv from invitations where token = invite_token for update;
  if not found then
    raise exception 'Invitation introuvable';
  end if;
  if exists (select 1 from family_members
             where family_id = inv.family_id and user_id = uid) then
    return inv.family_id; -- déjà membre : ne consomme pas le token
  end if;
  if inv.used_at is not null then
    raise exception 'Invitation déjà utilisée';
  end if;
  if inv.expires_at < now() then
    raise exception 'Invitation expirée';
  end if;

  insert into family_members (family_id, user_id, parent_index)
    values (inv.family_id, uid, inv.parent_index);
  update invitations set used_at = now() where token = invite_token;

  return inv.family_id;
end;
$$;

-- Régénère une invitation pour le siège encore vacant de sa propre famille
-- (parent 2 qui a perdu le lien, ou lien expiré). Invalide les tokens
-- précédents non utilisés.
create function regenerate_invitation(fid uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  vacant smallint;
  tok uuid;
begin
  if not is_member(fid) then
    raise exception 'Accès refusé';
  end if;

  select i into vacant
    from (values (0::smallint), (1::smallint)) seats(i)
    where not exists (select 1 from family_members
                      where family_id = fid and parent_index = seats.i)
    limit 1;
  if vacant is null then
    raise exception 'La famille est déjà complète';
  end if;

  delete from invitations where family_id = fid and used_at is null;
  insert into invitations (family_id, parent_index)
    values (fid, vacant) returning token into tok;

  return tok;
end;
$$;

revoke execute on function create_family(jsonb) from public, anon;
revoke execute on function join_family(uuid) from public, anon;
revoke execute on function regenerate_invitation(uuid) from public, anon;
grant execute on function create_family(jsonb) to authenticated;
grant execute on function join_family(uuid) to authenticated;
grant execute on function regenerate_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime : publication des tables synchronisées (RLS s'applique aussi aux
-- messages realtime — chaque client ne reçoit que les lignes de sa famille).
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table families;
alter publication supabase_realtime add table custody_overrides;
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table day_notes;
