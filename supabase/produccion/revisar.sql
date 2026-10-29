-- ============================================================
-- REVISIÓN DE PRODUCCIÓN (solo lectura). No cambia nada.
--   npx supabase db query --linked -f supabase/produccion/revisar.sql
-- Cada renglón: qué se revisa, ok (true/false) y el detalle.
-- ============================================================

with xg as (select 'a0000000-0000-4000-8000-000000000001'::uuid as id)
select * from (
  select 1 as n, 'RLS en todas las tablas' as que,
         not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                      where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as ok,
         coalesce((select string_agg(c.relname, ', ') from pg_class c join pg_namespace s on s.oid = c.relnamespace
                    where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'todas') as detalle
  union all
  select 2, 'anon sin permisos en tablas',
         not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'),
         coalesce((select string_agg(table_name || ':' || privilege_type, ', ') from information_schema.role_table_grants
                    where table_schema = 'public' and grantee = 'anon'), 'ninguno')
  union all
  select 3, 'anon solo ejecuta lo público',
         (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute'))
         = 'alta_admite_csf, aviso_privacidad_publico, confirmar_alta, contacto_soporte, correo_en_padron, datos_alta_publica, invitado_por, pedir_alta',
         (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute'))
  union all
  select 4, 'Tarea del cron programada',
         exists (select 1 from cron.job where jobname = 'tasa-conectores'),
         coalesce((select schedule || ' → ' || left(command, 60) from cron.job where jobname = 'tasa-conectores'), 'no existe')
  union all
  select 5, 'Secreto del cron en Vault',
         exists (select 1 from vault.secrets where name = 'cron_secret'),
         coalesce((select 'creado ' || to_char(created_at, 'YYYY-MM-DD HH24:MI') || ', actualizado ' || to_char(updated_at, 'YYYY-MM-DD HH24:MI')
                     from vault.secrets where name = 'cron_secret'), 'no existe')
  union all
  select 6, 'Solo existe la organización XG',
         (select count(*) from organizaciones) = 1 and exists (select 1 from organizaciones o, xg where o.id = xg.id),
         (select string_agg(slug, ', ') from organizaciones)
  union all
  select 7, 'Marcas con datos de PDF',
         (select count(*) from marcas m, xg where m.organizacion_id = xg.id and m.nombre_legal is not null and m.firmante is not null) = 4,
         (select string_agg(clave || ' ' || hoja || ' ' || tipografia || coalesce(' cuenta ' || (select alias from cuentas_receptoras c where c.id = m.cuenta_sugerida_id), ' sin cuenta'), ' · ' order by clave)
            from marcas m, xg where m.organizacion_id = xg.id)
  union all
  select 8, 'Cuentas receptoras (CLABE válida)',
         (select count(*) from cuentas_receptoras c, xg where c.organizacion_id = xg.id and c.activa and clabe_valida(c.clabe)) = 3
         and (select count(*) from cuentas_receptoras) = 3,
         (select string_agg(alias || ' ' || clabe, ' · ' order by alias) from cuentas_receptoras)
  union all
  select 9, 'Servicios activos',
         (select count(*) from servicios s, xg where s.organizacion_id = xg.id and s.activo) = 6 and (select count(*) from servicios) = 6,
         (select string_agg(nombre, ' · ' order by orden) from servicios)
  union all
  select 10, 'Niveles',
         (select string_agg(nombre || ' ' || coalesce(umbral_minimo::text, '—') || ' ' || coalesce(porcentaje::text, 'forzado'), ' · ' order by orden) from niveles)
         = 'Enlace 0.00 5.00 · Aliado 10000.00 10.00 · Socio 30000.00 12.50 · Socio Plus 60000.00 15.00 · Élite — forzado',
         (select string_agg(nombre || ' ' || coalesce(umbral_minimo::text, '—') || ' ' || coalesce(porcentaje::text, 'forzado'), ' · ' order by orden) from niveles)
  union all
  select 11, 'Ajustes de XG',
         (select contacto_soporte = 'soporte@xgplataform.com' and dia_limite_pago_comision = 10 and bienvenida_meses = 3 and arranque_meses = 2
                 and terminos_version = 2 and aviso_version = 1 and correo_bienvenida like 'Asunto: Te damos la bienvenida a Tasa%'
            from ajustes a, xg where a.organizacion_id = xg.id),
         (select 'contacto ' || contacto_soporte || ' · día ' || dia_limite_pago_comision || ' · bienvenida ' || bienvenida_meses
                 || 'm (' || (select nombre from niveles where id = bienvenida_nivel_id) || ') · arranque ' || arranque_meses || 'm ('
                 || (select nombre from niveles where id = arranque_nivel_id) || ') · términos v' || terminos_version || ' · aviso v' || aviso_version
                 || ' · prefijo ' || (select prefijo_folio from organizaciones o where o.id = a.organizacion_id)
            from ajustes a, xg where a.organizacion_id = xg.id)
  union all
  select 12, 'Tu persona de plataforma',
         exists (select 1 from personas p join membresias m on m.persona_id = p.id
                  where p.correo = 'xchel@arqosuv.com' and p.super_plataforma and m.rol = 'admin_org' and m.activa),
         (select string_agg(correo || case when super_plataforma then ' (super_plataforma)' else '' end, ', ') from personas where super_plataforma)
  union all
  select 13, 'Equipo de XG',
         (select count(*) from membresias m, xg where m.organizacion_id = xg.id and m.rol <> 'comisionista') = 8,
         (select string_agg(m.rol || ': ' || p.nombre, ' · ' order by m.rol, p.nombre) from membresias m join personas p on p.id = m.persona_id)
  union all
  select 14, 'Sin datos de prueba',
         (select count(*) from comisionistas) = 0 and (select count(*) from solicitudes) = 0 and (select count(*) from solicitudes_alta) = 0
         and (select count(*) from pagos) = 0 and (select count(*) from comisiones) = 0,
         'comisionistas ' || (select count(*) from comisionistas) || ' · trabajos ' || (select count(*) from solicitudes)
         || ' · solicitudes de alta ' || (select count(*) from solicitudes_alta) || ' · pagos ' || (select count(*) from pagos)
  union all
  select 15, 'Un solo conector activo',
         (select count(*) from conectores c, xg where c.organizacion_id = xg.id and c.activo) = 1,
         (select string_agg(tipo || case when activo then ' (activo)' else '' end, ', ') from conectores)
  union all
  select 16, 'Migraciones aplicadas hasta la 0038',
         (select max(version) from supabase_migrations.schema_migrations) = '0043',
         (select count(*) || ' migraciones, última ' || max(version) from supabase_migrations.schema_migrations)
) r order by n;
