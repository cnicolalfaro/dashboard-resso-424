-- Ejecutar en SQL Editor del proyecto RESSO OBS (no en NAMI).
-- Historial publico: solo lectura y creacion mediante funcion controlada.
begin;

create table public.resso_observations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  version text not null check (version in ('v10', 'v11')),
  question integer not null check (question between 1 and 40),
  author text not null check (char_length(btrim(author)) between 1 and 80 and author ~ '[^[:space:]]'),
  body text not null check (char_length(btrim(body)) between 1 and 3000 and body ~ '[^[:space:]]'),
  created_at timestamptz not null default clock_timestamp()
);

create index resso_observations_thread_idx
  on public.resso_observations (version, question, created_at desc, id desc);

alter table public.resso_observations enable row level security;
revoke all on public.resso_observations from public, anon, authenticated;
grant select on public.resso_observations to anon, authenticated;
create policy resso_observations_read
  on public.resso_observations for select to anon, authenticated using (true);

create function public.append_resso_observation(
  p_request_id uuid, p_version text, p_question integer, p_author text, p_body text
) returns setof public.resso_observations
language plpgsql security definer
set search_path = ''
as $$
declare
  existing public.resso_observations;
begin
  if p_request_id is null or p_version is null or p_version not in ('v10', 'v11')
     or p_question is null or p_question not between 1 and 40
     or p_author is null or char_length(btrim(p_author)) not between 1 and 80
     or p_author !~ '[^[:space:]]'
     or p_body is null or char_length(btrim(p_body)) not between 1 and 3000
     or p_body !~ '[^[:space:]]' then
    raise exception 'Version, pregunta, autor u observacion invalidos.' using errcode = 'P0001';
  end if;

  -- Serializa reintentos del mismo envio, incluso si cambian de pregunta.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select * into existing from public.resso_observations where request_id = p_request_id;
  if found then
    if existing.version <> p_version or existing.question <> p_question
       or existing.author <> btrim(p_author) or existing.body <> btrim(p_body) then
      raise exception 'El identificador de envio ya corresponde a otro aporte.' using errcode = 'P0001';
    end if;
    return next existing;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('resso:' || p_version || ':' || p_question::text, 1));
  if (select count(*) from public.resso_observations
      where version = p_version and question = p_question
      and created_at > clock_timestamp() - interval '1 minute') >= 20 then
    raise exception 'Limite temporal de aportes para esta pregunta. Espera un minuto.' using errcode = 'P0001';
  end if;

  return query insert into public.resso_observations
    (request_id, version, question, author, body)
    values (p_request_id, p_version, p_question, btrim(p_author), btrim(p_body))
    returning *;
end;
$$;

revoke all on function public.append_resso_observation(uuid, text, integer, text, text) from public;
grant execute on function public.append_resso_observation(uuid, text, integer, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
