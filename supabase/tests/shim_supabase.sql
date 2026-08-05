-- Shim d'environnement Supabase pour tester les migrations sur un Postgres nu
-- (sans Docker). Reproduit ce que la plateforme fournit déjà en production :
-- rôles anon/authenticated, schéma auth + auth.uid(), publication realtime.
-- À exécuter AVANT les migrations. Jamais déployé sur le vrai projet.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- Comme en production : lit le claim `sub` du JWT, null si non authentifié.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create publication supabase_realtime;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;

-- Supabase pose ces privilèges par défaut sur les nouvelles tables ; c'est la
-- RLS qui restreint ensuite. On reproduit via default privileges pour que les
-- tables créées par la migration soient couvertes.
alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant all on sequences to anon, authenticated;
