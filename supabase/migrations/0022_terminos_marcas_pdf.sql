-- ============================================================
-- 0022 — TÉRMINOS, DATOS DE MARCA PARA EL PDF Y NÚMERO DE COTIZACIÓN
--
-- 1. Términos: el comisionista acepta el texto vigente de su
--    organización la primera vez que entra, y de nuevo cada vez que el
--    texto cambia (cada cambio sube la versión). Queda la fecha.
-- 2. Marcas: lo que imprime el PDF de la marca ejecutora (nombre legal,
--    contacto, firmante, colores, tipografía, hoja, logo y otras formas
--    de pago). Prellenado para MGP, AP73 y ARQOS con los datos de la
--    skill de cotización; MGP con su marca 2026.
-- 3. Servicios: alcance, tiempo de entrega, documentos y aviso que van
--    en el PDF.
-- 4. Número de cotización AAMMDD-T#: consecutivo del día por
--    organización, propio de Tasa (no choca con los de la hoja de Google).
-- ============================================================

-- ------------------------------------------------------------
-- 1. TÉRMINOS
-- ------------------------------------------------------------

alter table ajustes add column terminos_version integer not null default 0;

-- Cada cambio del texto es una versión nueva que hay que volver a aceptar.
create or replace function versionar_terminos()
returns trigger language plpgsql as $$
begin
  if coalesce(new.terminos, '') is distinct from coalesce(old.terminos, '') and nullif(trim(new.terminos), '') is not null then
    new.terminos_version := old.terminos_version + 1;
  end if;
  return new;
end;
$$;

create trigger al_cambiar_terminos
  before update of terminos on ajustes
  for each row execute function versionar_terminos();

update ajustes set terminos_version = 1 where nullif(trim(terminos), '') is not null;

create table aceptaciones_terminos (
  organizacion_id  uuid not null default mi_org() references organizaciones(id) on delete restrict,
  persona_id       uuid not null references personas(id) on delete restrict,
  version          integer not null,
  aceptado_en      timestamptz not null default now(),
  primary key (organizacion_id, persona_id, version)
);

create trigger bitacora after insert or update or delete on aceptaciones_terminos
  for each row execute function registrar_bitacora();

-- ¿Le falta aceptar? Solo comisionistas, y solo si hay texto.
create or replace function debo_aceptar_terminos()
returns boolean language sql stable security definer set search_path = public as $$
  select mi_rol() = 'comisionista'
     and exists (
       select 1 from ajustes a
        where a.organizacion_id = mi_org() and nullif(trim(a.terminos), '') is not null
          and not exists (select 1 from aceptaciones_terminos t
                           where t.organizacion_id = a.organizacion_id and t.persona_id = mi_persona_id()
                             and t.version = a.terminos_version));
$$;

-- Acepta la versión que vio. Si el texto cambió mientras lo leía, no
-- cuenta: tiene que leer el nuevo.
create or replace function aceptar_terminos(p_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual integer;
begin
  if mi_persona_id() is null or mi_org() is null then
    raise exception 'Sin sesión';
  end if;
  select terminos_version into v_actual from ajustes where organizacion_id = mi_org();
  if v_actual is distinct from p_version then
    raise exception 'Los términos cambiaron mientras los leías: revisa la versión nueva';
  end if;
  insert into aceptaciones_terminos (organizacion_id, persona_id, version)
  values (mi_org(), mi_persona_id(), p_version)
  on conflict do nothing;
end;
$$;

create or replace function mi_sesion()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persona_id',       p.id,
    'nombre',           p.nombre,
    'correo',           p.correo,
    'super_plataforma', p.super_plataforma,
    'rol',              mi_rol(),
    'organizacion',     (select jsonb_build_object('id', o.id, 'nombre', o.nombre, 'slug', o.slug)
                           from organizaciones o where o.id = mi_org()),
    'visitante',        p.super_plataforma and mi_org() is not null and not exists (
                          select 1 from membresias m
                           where m.persona_id = p.id and m.organizacion_id = mi_org() and m.activa),
    'organizaciones',   (select count(*) from mis_organizaciones()),
    'debe_aceptar_terminos', debo_aceptar_terminos()
  )
    from personas p
   where p.user_id = auth.uid() and p.activo;
$$;

alter table aceptaciones_terminos enable row level security;
revoke all on aceptaciones_terminos from anon;
grant select on aceptaciones_terminos to authenticated;
revoke insert, update, delete on aceptaciones_terminos from authenticated;
create policy leer_aceptaciones on aceptaciones_terminos for select
  using (organizacion_id = (select mi_org())
         and (persona_id = (select mi_persona_id()) or (select mi_rol()) in ('admin_org', 'finanzas', 'admin_marca')));

-- ------------------------------------------------------------
-- 2. LO QUE IMPRIME CADA MARCA
-- ------------------------------------------------------------

alter table marcas
  add column nombre_legal text check (char_length(nombre_legal) <= 160),
  add column direccion text check (char_length(direccion) <= 200),
  add column correo text check (char_length(correo) <= 120),
  add column telefonos text check (char_length(telefonos) <= 120),
  add column firmante text check (char_length(firmante) <= 120),
  add column firmante_cargo text check (char_length(firmante_cargo) <= 120),
  -- Una por línea: "Título | detalle" (tarjeta, efectivo…). La cuenta
  -- receptora del trabajo siempre va primero.
  add column formas_pago text check (char_length(formas_pago) <= 1000),
  add column color_acento text check (color_acento ~ '^#[0-9a-fA-F]{6}$'),
  add column color_claro text check (color_claro ~ '^#[0-9a-fA-F]{6}$'),
  add column tipografia text not null default 'adventor' check (tipografia in ('adventor', 'manrope')),
  add column hoja text not null default 'carta' check (hoja in ('carta', 'oficio')),
  -- En el bucket privado `marcas`: {organización}/{archivo}.
  add column logo_ruta text;

update marcas set
  nombre_legal = 'MGP Ingeniería & Consultoría Inmobiliaria',
  direccion = 'High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.',
  correo = 'avaluosmgp@gmail.com',
  telefonos = '442 682 1525 · 442 109 1882',
  firmante = 'M. en C. Mitzin Xchel Guerrero Solorio',
  firmante_cargo = 'Director de Operaciones',
  formas_pago = 'Efectivo | Al momento de la visita al inmueble.',
  color = '#04386C', color_acento = '#006DB3', color_claro = '#E7F0F8',
  tipografia = 'manrope', hoja = 'carta'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001' and clave = 'MGP';

update marcas set
  nombre_legal = 'AP73 · Adrián Puente',
  direccion = 'High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.',
  correo = 'gerencia@ap73.mx · apuente@ap73.mx',
  telefonos = '442 682 1525 · 442 426 1073',
  firmante = 'M. en C. Adrián Gonzalo Puente Suárez',
  firmante_cargo = 'Tasador con registro en el Estado de Querétaro',
  formas_pago = E'Tarjeta de débito o crédito | Solicite su liga de pago en línea. Con tarjeta de crédito puede diferir hasta 3 meses sin intereses.\nEfectivo | Al momento de la visita al inmueble.',
  color = '#262626', color_acento = '#262626', color_claro = '#EFEFEF',
  tipografia = 'adventor', hoja = 'oficio'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001' and clave = 'AP73';

update marcas set
  nombre_legal = 'ARQOS Unidad de Valuación en Inteligencia Inmobiliaria, S.A. de C.V.',
  direccion = 'High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.',
  correo = 'avaluosmgp@gmail.com',
  telefonos = '442 682 1525 · 442 109 1882',
  firmante = 'M. en C. Mitzin Xchel Guerrero Solorio',
  firmante_cargo = 'Director de Operaciones',
  formas_pago = E'Tarjeta de débito o crédito | En línea en link.mercadopago.com.mx/arqos (capture el monto de esta cotización).\nEfectivo | Al momento de la visita al inmueble.',
  color = '#1F3C6E', color_acento = '#1F3C6E', color_claro = '#E8EDF5',
  tipografia = 'adventor', hoja = 'carta'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001' and clave = 'ARQOS';

insert into storage.buckets (id, name, public) values ('marcas', 'marcas', false)
on conflict (id) do nothing;

create policy marcas_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marcas'
              and (storage.foldername(name))[1] = (select public.mi_org())::text
              and (select public.soy_admin_org()));

create policy marcas_leer on storage.objects
  for select to authenticated
  using (bucket_id = 'marcas'
         and (storage.foldername(name))[1] = (select public.mi_org())::text
         and (select public.mi_rol()) in ('admin_org', 'finanzas', 'admin_marca'));

-- ------------------------------------------------------------
-- 3. LO QUE IMPRIME CADA SERVICIO
-- ------------------------------------------------------------

alter table servicios
  add column alcance text check (char_length(alcance) <= 2000),
  add column tiempo_entrega text check (char_length(tiempo_entrega) <= 300),
  -- Uno por línea.
  add column documentos text check (char_length(documentos) <= 2000),
  add column aviso text check (char_length(aviso) <= 2000);

update servicios set
  tiempo_entrega = '5 días hábiles a partir de recibir el anticipo y la información completa',
  alcance = 'Investigación de mercado, selección y homologación de comparables y emisión de una Opinión de Valor con valor estimado y rango de referencia; con inspección física cuando el servicio la incluye.',
  documentos = E'Ubicación del inmueble y, de preferencia, clave catastral.\nSuperficies de terreno y construcción (escritura, plano o boleta predial).\nFotografías recientes si el servicio es sin visita.',
  aviso = 'La Opinión de Valor es un documento informativo para uso exclusivo del solicitante. No es un avalúo y no es válida para créditos, juicios, trámites fiscales ni para presentarse ante terceros. Si dentro de los 60 días siguientes contrata un avalúo comercial del mismo inmueble, el importe pagado podrá considerarse como descuento, total o parcial, sobre sus honorarios.'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001' and nombre = 'Opinión de Valor';

update servicios set
  tiempo_entrega = '5 días hábiles posteriores a la visita',
  alcance = 'Revisión documental, inspección física, investigación de mercado, aplicación de los enfoques de valuación que correspondan al propósito, conciliación de resultados e informe firmado por perito valuador.',
  documentos = E'Escritura o título de propiedad.\nBoleta predial vigente.\nPlanos o licencia de construcción, si existen.\nIdentificación oficial del solicitante.',
  aviso = 'El avalúo se elabora para el propósito declarado en esta propuesta y es válido únicamente para dicho propósito durante 6 meses a partir de su fecha.'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001' and nombre in ('Avalúo Comercial', 'Avalúo Condominal y Mem Desc');

update servicios set
  tiempo_entrega = '3 días hábiles posteriores a la visita',
  alcance = 'Avalúo hacendario para el cálculo de impuestos y derechos inmobiliarios, firmado por perito con registro en el Estado. Incluye los derechos y el trámite del folio hacendario.',
  documentos = E'Solicitante: identificación oficial y comprobante de domicilio.\nPropietario: identificación oficial y comprobante de domicilio.\nInmueble: escritura.\nPersona moral: identificación y comprobante de domicilio del apoderado legal, poder notarial y acta constitutiva.',
  aviso = 'El folio hacendario se tramita con la documentación completa; cualquier dato faltante o inconsistente puede retrasar su emisión.'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001' and nombre = 'Avalúo Hacendario';

update servicios set
  tiempo_entrega = '10 días hábiles',
  alcance = 'Elaboración de dictamen pericial en materia de valuación inmobiliaria conforme a lo solicitado por el órgano jurisdiccional.',
  documentos = E'Número de expediente y juzgado.\nCopia del auto o cuestionario a desahogar.\nEscritura y boleta predial del inmueble.',
  aviso = 'Los honorarios no incluyen ratificaciones, juntas de peritos ni ampliaciones del dictamen, que se cotizarán por separado.'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001' and nombre = 'Peritaje para el Poder Judicial';

update servicios set
  tiempo_entrega = '15 días hábiles',
  alcance = 'Avalúo para crédito conforme a la normatividad de la institución, elaborado por unidad de valuación autorizada.',
  documentos = E'Escritura y boleta predial.\nIdentificación oficial del propietario.\nDocumentación adicional que solicite la institución.',
  aviso = 'El avalúo se elabora conforme a los lineamientos de la institución acreditante y solo es válido para el trámite del crédito.'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001' and nombre = 'Avalúo Bancario';

-- ------------------------------------------------------------
-- 4. NÚMERO DE COTIZACIÓN: AAMMDD-T#
-- ------------------------------------------------------------

alter table cotizaciones add column numero text;

with numerados as (
  select id, to_char((emitida_en at time zone 'America/Mexico_City')::date, 'YYMMDD') || '-T'
             || row_number() over (partition by organizacion_id, (emitida_en at time zone 'America/Mexico_City')::date
                                   order by emitida_en, id) as numero
    from cotizaciones
)
update cotizaciones c set numero = n.numero from numerados n where n.id = c.id;

alter table cotizaciones add constraint cotizaciones_numero_unico unique (organizacion_id, numero);

create or replace function numerar_cotizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dia text := to_char(hoy_mx(), 'YYMMDD');
begin
  -- Un candado por organización y día: dos emisiones al mismo tiempo no
  -- sacan el mismo número.
  perform pg_advisory_xact_lock(hashtext(new.organizacion_id::text || v_dia));
  select v_dia || '-T' || (coalesce(max(substring(numero from '-T([0-9]+)$')::int), 0) + 1)
    into new.numero
    from cotizaciones
   where organizacion_id = new.organizacion_id and numero like v_dia || '-T%';
  return new;
end;
$$;

create trigger numerar
  before insert on cotizaciones
  for each row execute function numerar_cotizacion();

-- ------------------------------------------------------------
-- 5. PERMISOS
-- ------------------------------------------------------------

revoke all on function versionar_terminos(), debo_aceptar_terminos(), aceptar_terminos(integer),
  numerar_cotizacion() from public, anon, authenticated;
grant execute on function debo_aceptar_terminos(), aceptar_terminos(integer) to authenticated;
