-- Tests des policies RLS et des RPC. Exécuté en superuser sur un cluster
-- jetable (voir run-local.sh) ; bascule de rôle avec SET ROLE + claim JWT
-- simulé pour incarner tour à tour parent 1 (u1), parent 2 (u2) et un
-- inconnu authentifié (u3). Tout échec lève une exception (ON_ERROR_STOP).

\set ON_ERROR_STOP on

create schema tests;
grant usage on schema tests to anon, authenticated;

create table tests.vars (key text primary key, value text);
grant all on tests.vars to anon, authenticated;

create function tests.check(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'ÉCHEC : %', msg;
  end if;
  raise notice 'OK : %', msg;
end
$$;

create function tests.expect_error(sql text, pattern text, msg text) returns void
language plpgsql as $$
declare
  ok boolean := false;
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm ~* pattern then
      ok := true;
    else
      raise exception 'ÉCHEC : % — erreur inattendue : %', msg, sqlerrm;
    end if;
  end;
  if not ok then
    raise exception 'ÉCHEC : % — aucune erreur levée', msg;
  end if;
  raise notice 'OK : %', msg;
end
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- Trois utilisateurs : u1 = parent 1, u2 = parent 2, u3 = inconnu authentifié.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'u1@test'),
  ('00000000-0000-0000-0000-000000000002', 'u2@test'),
  ('00000000-0000-0000-0000-000000000003', 'u3@test');

-- ---------------------------------------------------------------------------
-- create_family (u1)
-- ---------------------------------------------------------------------------

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

do $$
declare
  res json;
begin
  res := create_family('{
    "parents": ["Alice", "Bruno"],
    "children": ["Léa"],
    "rotation": {"type": "week", "anchor": "2026-01-05", "start": 0}
  }'::jsonb);
  insert into tests.vars values ('fid', res->>'family_id'), ('tok', res->>'invite_token');
  perform tests.check(res->>'family_id' is not null and res->>'invite_token' is not null,
    'create_family retourne family_id et invite_token');
end
$$;

select tests.expect_error(
  $q$ select create_family('{"parents": ["Seule"], "children": ["X"],
       "rotation": {"type": "week", "anchor": "2026-01-05", "start": 0}}'::jsonb) $q$,
  'deux parents', 'create_family rejette une config sans deux parents');

select tests.expect_error(
  $q$ select create_family('{"parents": ["A", "B"], "children": ["X"],
       "rotation": {"type": "biweek", "anchor": "2026-01-05", "start": 0}}'::jsonb) $q$,
  'rotation', 'create_family rejette un type de rotation inconnu');

-- u1 est membre : lecture + écritures sur les tables de données.
do $$
declare
  fid uuid := (select value::uuid from tests.vars where key = 'fid');
begin
  perform tests.check((select count(*) from families where id = fid) = 1,
    'u1 voit sa famille');
  perform tests.check((select count(*) from family_members) = 1,
    'u1 voit sa propre adhésion');

  insert into custody_overrides (family_id, day, parent_index, updated_by)
    values (fid, '2026-01-07', 1, auth.uid());
  insert into events (family_id, day, title, time, created_by)
    values (fid, '2026-01-07', 'Pédiatre', '10:30', auth.uid());
  insert into day_notes (family_id, day, note, updated_by)
    values (fid, '2026-01-07', 'Doudou dans le sac', auth.uid());
  perform tests.check(true, 'u1 écrit override + événement + note');

  update families set config = jsonb_set(config, '{children}', '["Léa", "Tom"]') where id = fid;
  perform tests.check((select config->'children' from families where id = fid) = '["Léa", "Tom"]',
    'u1 modifie la config de sa famille');
end
$$;

select tests.expect_error(
  $q$ insert into events (family_id, day, title, time)
      values ((select value::uuid from tests.vars where key = 'fid'), '2026-01-07', 'X', '25:99') $q$,
  'check constraint', 'le format d''heure des événements est contrôlé');

-- ---------------------------------------------------------------------------
-- Étanchéité : u3 (authentifié, hors famille) ne voit rien, n'écrit rien.
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

do $$
declare
  fid uuid := (select value::uuid from tests.vars where key = 'fid');
  n integer;
begin
  perform tests.check((select count(*) from families) = 0, 'u3 ne voit aucune famille');
  perform tests.check((select count(*) from family_members) = 0, 'u3 ne voit aucune adhésion');
  perform tests.check((select count(*) from custody_overrides) = 0, 'u3 ne voit aucun override');
  perform tests.check((select count(*) from events) = 0, 'u3 ne voit aucun événement');
  perform tests.check((select count(*) from day_notes) = 0, 'u3 ne voit aucune note');
  perform tests.check((select count(*) from invitations) = 0, 'u3 ne voit aucune invitation');

  -- update/delete d'un inconnu : 0 ligne touchée (filtré par using).
  update families set config = '{}'::jsonb where id = fid;
  get diagnostics n = row_count;
  perform tests.check(n = 0, 'u3 ne modifie pas la config d''une famille étrangère');
  delete from events where family_id = fid;
  get diagnostics n = row_count;
  perform tests.check(n = 0, 'u3 ne supprime aucun événement étranger');
end
$$;

-- insert d'un inconnu vers notre famille : bloqué par with check.
select tests.expect_error(
  $q$ insert into custody_overrides (family_id, day, parent_index)
      values ((select value::uuid from tests.vars where key = 'fid'), '2026-01-08', 0) $q$,
  'row-level security', 'with check bloque l''insert d''override par un inconnu');

select tests.expect_error(
  $q$ insert into events (family_id, day, title)
      values ((select value::uuid from tests.vars where key = 'fid'), '2026-01-08', 'Intrusion') $q$,
  'row-level security', 'with check bloque l''insert d''événement par un inconnu');

select tests.expect_error(
  $q$ insert into day_notes (family_id, day, note)
      values ((select value::uuid from tests.vars where key = 'fid'), '2026-01-08', 'Intrusion') $q$,
  'row-level security', 'with check bloque l''insert de note par un inconnu');

-- family_members / invitations : aucune écriture directe possible, même en
-- se désignant soi-même.
select tests.expect_error(
  $q$ insert into family_members (family_id, user_id, parent_index)
      values ((select value::uuid from tests.vars where key = 'fid'),
              '00000000-0000-0000-0000-000000000003', 1) $q$,
  'row-level security', 'insert direct dans family_members impossible');

select tests.expect_error(
  $q$ insert into invitations (family_id, parent_index)
      values ((select value::uuid from tests.vars where key = 'fid'), 1) $q$,
  'row-level security', 'insert direct dans invitations impossible');

-- regenerate_invitation refusé hors famille.
select tests.expect_error(
  $q$ select regenerate_invitation((select value::uuid from tests.vars where key = 'fid')) $q$,
  'Accès refusé', 'regenerate_invitation refuse un non-membre');

-- ---------------------------------------------------------------------------
-- join_family (u2) : cas nominal + tokens invalides
-- ---------------------------------------------------------------------------

select tests.expect_error(
  $q$ select join_family('11111111-1111-1111-1111-111111111111') $q$,
  'introuvable', 'join_family rejette un token inconnu');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

do $$
declare
  fid uuid := (select value::uuid from tests.vars where key = 'fid');
  tok uuid := (select value::uuid from tests.vars where key = 'tok');
  joined uuid;
begin
  joined := join_family(tok);
  perform tests.check(joined = fid, 'u2 rejoint la famille via le token');
  perform tests.check((select count(*) from families) = 1, 'u2 voit désormais la famille');
  perform tests.check((select count(*) from custody_overrides) = 1, 'u2 voit les overrides');
  perform tests.check((select parent_index from family_members
                       where user_id = auth.uid()) = 1, 'u2 occupe le siège parent 2');

  joined := join_family(tok);
  perform tests.check(joined = fid, 'join_family est idempotent pour un membre');

  insert into events (family_id, day, title, created_by)
    values (fid, '2026-01-09', 'École', auth.uid());
  perform tests.check(true, 'u2 écrit un événement');
end
$$;

-- Le token consommé ne sert plus à un tiers.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select tests.expect_error(
  $q$ select join_family((select value::uuid from tests.vars where key = 'tok')) $q$,
  'déjà utilisée', 'join_family rejette un token déjà utilisé');

-- Famille complète : plus d'invitation possible.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select tests.expect_error(
  $q$ select regenerate_invitation((select value::uuid from tests.vars where key = 'fid')) $q$,
  'complète', 'regenerate_invitation refuse une famille complète');

-- ---------------------------------------------------------------------------
-- Token expiré + regenerate_invitation sur siège vacant (2e famille, u3)
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

do $$
declare
  res json;
begin
  res := create_family('{
    "parents": ["Chloé", "David"],
    "children": ["Emma"],
    "rotation": {"type": "223", "anchor": "2026-01-05", "start": 1}
  }'::jsonb);
  insert into tests.vars values ('fid2', res->>'family_id'), ('tok2', res->>'invite_token');
end
$$;

-- Expiration forcée en superuser (seul capable de toucher invitations).
reset role;
update invitations
  set expires_at = now() - interval '1 minute'
  where token = (select value::uuid from tests.vars where key = 'tok2');
set role authenticated;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select tests.expect_error(
  $q$ select join_family((select value::uuid from tests.vars where key = 'tok2')) $q$,
  'expirée', 'join_family rejette un token expiré');

-- u3, membre de la famille 2, régénère une invitation pour le siège vacant.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
declare
  fid2 uuid := (select value::uuid from tests.vars where key = 'fid2');
  tok3 uuid;
begin
  tok3 := regenerate_invitation(fid2);
  perform tests.check(tok3 is not null, 'regenerate_invitation émet un nouveau token');
  insert into tests.vars values ('tok3', tok3::text);
end
$$;

reset role;
do $$
begin
  perform tests.check(
    (select count(*) from invitations
     where family_id = (select value::uuid from tests.vars where key = 'fid2')
       and used_at is null) = 1,
    'l''ancien token non utilisé a été invalidé');
end
$$;
set role authenticated;

-- Le nouveau token fonctionne pour u2.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare
  fid2 uuid := (select value::uuid from tests.vars where key = 'fid2');
begin
  perform tests.check(join_family((select value::uuid from tests.vars where key = 'tok3')) = fid2,
    'le token régénéré permet de rejoindre');
end
$$;

-- ---------------------------------------------------------------------------
-- Cloisonnement entre familles + anon + non authentifié
-- ---------------------------------------------------------------------------

-- u1 (famille 1 uniquement) ne voit rien de la famille 2.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare
  fid2 uuid := (select value::uuid from tests.vars where key = 'fid2');
begin
  perform tests.check((select count(*) from families where id = fid2) = 0,
    'u1 ne voit pas la famille 2');
  perform tests.check((select count(*) from families) = 1,
    'u1 ne voit que sa propre famille');
end
$$;

-- Authentifié mais sans claim (session cassée) : les RPC refusent.
set request.jwt.claim.sub = '';
select tests.expect_error(
  $q$ select create_family('{"parents": ["A", "B"], "children": ["X"],
       "rotation": {"type": "week", "anchor": "2026-01-05", "start": 0}}'::jsonb) $q$,
  'Authentification requise', 'create_family exige une session');
select tests.expect_error(
  $q$ select join_family((select value::uuid from tests.vars where key = 'tok')) $q$,
  'Authentification requise', 'join_family exige une session');

-- anon : aucune donnée visible, RPC inaccessibles.
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$
begin
  perform tests.check((select count(*) from families) = 0, 'anon ne voit aucune famille');
  perform tests.check((select count(*) from events) = 0, 'anon ne voit aucun événement');
end
$$;
select tests.expect_error(
  $q$ select create_family('{}'::jsonb) $q$,
  'permission denied', 'anon ne peut pas appeler create_family');
select tests.expect_error(
  $q$ select join_family('11111111-1111-1111-1111-111111111111') $q$,
  'permission denied', 'anon ne peut pas appeler join_family');

reset role;
select 'TOUS LES TESTS RLS SONT PASSÉS' as resultat;
