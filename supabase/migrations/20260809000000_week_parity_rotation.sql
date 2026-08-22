-- Rythme « semaines paires / impaires » : create_family accepte le type de
-- rotation 'weekParity' (avec ses champs optionnels evenWeeksParent /
-- alternateYearly) introduit côté app.

create or replace function create_family(config jsonb)
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
  if config->'rotation'->>'type' not in ('week', 'weekParity', '223', 'manual')
     or (config->'rotation'->>'anchor') !~ '^\d{4}-\d{2}-\d{2}$'
     or (config->'rotation'->>'start') not in ('0', '1')
     or (config->'rotation' ? 'evenWeeksParent'
         and config->'rotation'->>'evenWeeksParent' not in ('0', '1')) then
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
