-- ============================================================
-- 0058 — TEXTOS DE INVITACIÓN EDITABLES EN AJUSTES
--
-- El mensaje de WhatsApp de "Invita a un comisionista" y el de "Para tus
-- clientes" se editan en Ajustes, con versión y bitácora (el disparador
-- de bitácora de ajustes ya existe). {liga} se reemplaza por la liga de
-- quien comparte; sin {liga} no se guarda. La invitación deja de hablar
-- de "ganar comisiones" (decisión de Xchel, 06-nov-2026).
-- ============================================================

alter table ajustes
  add column texto_invitar text not null default
    'Te invito a Tasa, la plataforma para aliados comerciales en valuación inmobiliaria. Regístrate aquí y disfruta de las herramientas diseñadas para ti: {liga}'
    check (char_length(texto_invitar) <= 500 and position('{liga}' in texto_invitar) > 0),
  add column texto_clientes text not null default
    'Hola. Para pedir tu cotización o tu trámite de avalúo, llena esta solicitud: {liga}'
    check (char_length(texto_clientes) <= 500 and position('{liga}' in texto_clientes) > 0),
  add column textos_version integer not null default 1,
  add column textos_actualizados_en timestamptz;

create or replace function versionar_textos_invitacion()
returns trigger language plpgsql as $$
begin
  if (new.texto_invitar, new.texto_clientes) is distinct from (old.texto_invitar, old.texto_clientes) then
    new.textos_version := old.textos_version + 1;
    new.textos_actualizados_en := now();
  end if;
  return new;
end;
$$;
create trigger al_cambiar_textos_invitacion before update on ajustes
  for each row execute function versionar_textos_invitacion();

revoke all on function versionar_textos_invitacion() from public, anon, authenticated;
