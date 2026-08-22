-- Assertion helpers for the SQL suite. Test-only; not a migration.
create schema if not exists t;
-- the role-switched blocks in 04_rls.sql read fixtures out of this schema
grant usage on schema t to authenticated;
create table if not exists t.fx (k text primary key, v uuid);
grant select on t.fx to authenticated;

create or replace function t.ok(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_cond then raise notice '  ok    %', p_label;
  else raise exception 'FAIL: %', p_label; end if;
end $$;

create or replace function t.close(p_actual double precision, p_expected double precision,
                                   p_tol double precision, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is null then raise exception 'FAIL: % — got null', p_label; end if;
  if abs(p_actual - p_expected) <= p_tol then
    raise notice '  ok    % (% ≈ %)', p_label, round(p_actual::numeric, 9), p_expected;
  else
    raise exception 'FAIL: % — expected % got % (Δ %)',
      p_label, p_expected, p_actual, abs(p_actual - p_expected);
  end if;
end $$;

create or replace function t.raises(p_sql text, p_msg text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_msg in sqlerrm) > 0 then
      raise notice '  ok    % (raised %)', p_label, p_msg; return;
    end if;
    raise exception 'FAIL: % — expected "%" got "%"', p_label, p_msg, sqlerrm;
  end;
  raise exception 'FAIL: % — expected "%" but nothing was raised', p_label, p_msg;
end $$;

-- Create a signed-in session for a given profile, the way Supabase does.
create or replace function t.as_user(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
end $$;

-- Make a user + profile. Returns the profile id.
create or replace function t.mkuser(p_name text, p_role user_role default 'trader',
                                    p_balance numeric default 1000)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into auth.users (email) values (lower(p_name) || '@example.test') returning id into v_id;
  -- handle_new_user() already made the profile; set it up for testing
  update profiles set display_name = p_name, role = p_role, is_approved = true
    where id = v_id;
  if p_balance <> 1000 then perform t.force_balance(v_id, p_balance); end if;
  return v_id;
end $$;

-- Set a balance directly, keeping the ledger consistent (test fixture only).
create or replace function t.force_balance(p_uid uuid, p_bal numeric) returns void
language plpgsql as $$
declare v_cur numeric;
begin
  select balance into v_cur from profiles where id = p_uid;
  update profiles set balance = p_bal where id = p_uid;
  insert into bets (profile_id, kind, amount, balance_after, note)
  values (p_uid, 'adjust', p_bal - v_cur, p_bal, 'test fixture');
end $$;
