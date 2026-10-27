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
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;

-- Supabase les da permisos por omisión a anon y authenticated. Se
-- replica para que los `revoke ... from anon` de las migraciones
-- prueben algo de verdad.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
