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
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
                              created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- Supabase Vault, en su forma más simple: aquí el "cifrado" no importa,
-- importa que nadie con sesión pueda leerlo y que las funciones sí.
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, description text, secret text);
-- Como en Supabase: el nombre de un secreto es único (secrets_name_idx).
create unique index secrets_name_idx on vault.secrets (name) where name is not null;
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id
$$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                    new_description text default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id
$$;
revoke all on schema vault from public;

-- Como en Supabase: con sesión se puede intentar leer y subir; el RLS decide.
grant usage on schema storage to authenticated;
grant select, insert on storage.objects to authenticated;
-- anon sube la CSF de su solicitud de alta (la política decide cuál).
grant usage on schema storage to anon;
grant insert on storage.objects to anon;
