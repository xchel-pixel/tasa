-- Lo mínimo de Supabase para correr las migraciones en PGlite (un
-- Postgres que vive dentro de Node). Solo lo usan las pruebas: en
-- Supabase todo esto ya existe.
--
-- `auth.uid()` lee la sesión igual que el de Supabase: una sesión
-- vacía da nulo, no error.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon, service_role;

-- El proyecto real tiene "Automatically expose new tables" APAGADO:
-- las tablas nuevas no le dan permisos a nadie. Aquí tampoco, así que
-- si a 0010_permisos.sql le falta un GRANT, las pruebas de permisos
-- truenan igual que tronaría la aplicación.

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
