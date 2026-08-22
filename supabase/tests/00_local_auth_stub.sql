-- ============================================================
-- 00_local_auth_stub.sql — LOCAL TEST HARNESS ONLY. NOT A MIGRATION.
--
-- Supabase supplies the `auth` schema, `auth.users`, `auth.uid()` and the
-- `anon` / `authenticated` / `service_role` roles. A bare Postgres does not,
-- so this recreates just enough of them to run the migrations and their tests
-- against a plain `initdb` cluster. Nothing here ships.
--
-- auth.uid() reads the request.jwt.claim.sub GUC exactly as Supabase's does,
-- so `set local role authenticated; set local request.jwt.claim.sub = '<uuid>'`
-- exercises the real RLS path.
-- ============================================================
create schema if not exists auth;

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  created_at    timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
