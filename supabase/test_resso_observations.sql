-- Ejecutar DESPUES de resso_observations.sql, en SQL Editor.
-- Todo se revierte al final; no deja comentarios de prueba.
begin;
set local role anon;

do $$
declare
  key uuid := gen_random_uuid();
  first_row public.resso_observations;
  repeated public.resso_observations;
  other_version public.resso_observations;
  n integer;
begin
  select * into first_row from public.append_resso_observation(key, 'v10', 40, 'Prueba temporal', 'Historial v10');
  select * into repeated from public.append_resso_observation(key, 'v10', 40, 'Prueba temporal', 'Historial v10');
  if first_row.id is null or first_row.id <> repeated.id then
    raise exception 'Fallo la idempotencia';
  end if;
  if first_row.created_at is null then raise exception 'Falta fecha de servidor'; end if;
  select * into other_version from public.append_resso_observation(
    gen_random_uuid(), 'v11', 40, 'Prueba temporal', 'Historial v11');
  if other_version.id = first_row.id or other_version.version <> 'v11'
     or first_row.version <> 'v10' then
    raise exception 'Se mezclaron las versiones';
  end if;
  select count(*) into n from public.resso_observations where request_id = key;
  if n <> 1 then raise exception 'Aporte duplicado o lectura denegada'; end if;

  begin
    update public.resso_observations set body = 'Alterado' where id = first_row.id;
    raise exception 'Se permitio UPDATE';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.resso_observations where id = first_row.id;
    raise exception 'Se permitio DELETE';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.resso_observations (request_id, version, question, author, body)
      values (gen_random_uuid(), 'v10', 1, 'Bypass', 'No permitido');
    raise exception 'Se permitio INSERT directo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.append_resso_observation(gen_random_uuid(), 'v12', 1, 'Prueba', 'No permitido');
    raise exception 'Se permitio version invalida';
  exception when raise_exception then
    if sqlerrm <> 'Version, pregunta, autor u observacion invalidos.' then raise; end if;
  end;
  begin
    perform public.append_resso_observation(key, 'v10', 40, 'Prueba temporal', 'Cambio de contenido');
    raise exception 'Se permitio cambiar un aporte con el mismo identificador';
  exception when raise_exception then
    if sqlerrm <> 'El identificador de envio ya corresponde a otro aporte.' then raise; end if;
  end;
  begin
    perform public.append_resso_observation(gen_random_uuid(), 'v10', 0, 'Prueba', 'No permitido');
    raise exception 'Se permitio pregunta invalida';
  exception when raise_exception then
    if sqlerrm <> 'Version, pregunta, autor u observacion invalidos.' then raise; end if;
  end;
  begin
    perform public.append_resso_observation(gen_random_uuid(), 'v10', 1, 'Prueba', E'\n\t');
    raise exception 'Se permitio texto vacio';
  exception when raise_exception then
    if sqlerrm <> 'Version, pregunta, autor u observacion invalidos.' then raise; end if;
  end;
  begin
    perform public.append_resso_observation(gen_random_uuid(), 'v10', 1, 'Prueba', repeat('x', 3001));
    raise exception 'Se permitio texto demasiado largo';
  exception when raise_exception then
    if sqlerrm <> 'Version, pregunta, autor u observacion invalidos.' then raise; end if;
  end;
end;
$$;
rollback;
