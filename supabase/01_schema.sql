-- =====================================================================
-- pressio — database v2
-- Content lives here, never inside the website files.
-- Safe to run more than once.
-- =====================================================================

create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------
-- Staff: accounts are created in Supabase Auth; this table holds the role.
-- New accounts start INACTIVE and must be approved by the owner.
-- ---------------------------------------------------------------------
alter table public.staff add column if not exists email text;
alter table public.staff alter column active set default false;

update public.staff s set email = u.email
from auth.users u where u.id = s.id and s.email is null;

-- The role is never taken from sign-up metadata (that was a hole: anyone
-- signing up could have asked to be admin). Every new account is plain
-- staff and inactive until approved.
create or replace function public.handle_new_staff_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.staff (id, full_name, role, active, email)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
          'staff', false, new.email)
  on conflict (id) do nothing;
  return new;
end $fn$;

create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = public as $fn$
  select role from public.staff where id = auth.uid() and active
$fn$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists(select 1 from public.staff where id = auth.uid() and active)
$fn$;
create or replace function private.is_editor() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(public.current_staff_role() in ('admin','manager'), false)
$fn$;
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(public.current_staff_role() = 'admin', false)
$fn$;
grant execute on function private.is_staff(), private.is_editor(), private.is_admin() to anon, authenticated;

-- Staff: owner manages roles; nobody can promote themselves.
drop policy if exists staff_admin_all on public.staff;
create policy staff_admin_all on public.staff for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- ---------------------------------------------------------------------
-- Content tables
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id text primary key default gen_random_uuid()::text,
  sort int not null default 0,
  name_ar text not null default '',
  name_en text not null default '',
  hours_from smallint check (hours_from between 0 and 24),
  hours_to smallint check (hours_to between 0 and 24),
  visible boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id text primary key default gen_random_uuid()::text,
  category_id text not null references public.categories(id) on update cascade on delete restrict,
  sort int not null default 0,
  name_ar text not null default '',
  name_en text not null default '',
  desc_ar text not null default '',
  desc_en text not null default '',
  price numeric(10,2) not null default 0 check (price >= 0),
  available boolean not null default true,
  hidden boolean not null default false,
  featured boolean not null default false,
  snooze_until timestamptz,
  images text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists items_category_idx on public.items(category_id, sort);

-- Every photo, video and document. Photos/videos are public; documents are private.
create table if not exists public.media (
  id text primary key default gen_random_uuid()::text,
  kind text not null check (kind in ('menu','venue','brand','video','docs')),
  folder text not null default '',
  url text not null,
  bucket text,
  path text,
  mime text,
  width int, height int, bytes int,
  alt_ar text not null default '',
  alt_en text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists media_kind_idx on public.media(kind, folder, created_at desc);

alter table public.invoices add column if not exists category text;

-- ---------------------------------------------------------------------
-- History (every change, who, when — read-only audit trail)
-- and snapshots (full versions of the site content you can restore)
-- ---------------------------------------------------------------------
create table if not exists public.content_history (
  id bigserial primary key,
  table_name text not null,
  row_id text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists content_history_at_idx on public.content_history(changed_at desc);

create table if not exists public.snapshots (
  id bigserial primary key,
  label text not null default '',
  kind text not null default 'manual' check (kind in ('auto','manual','pre-restore','import')),
  data jsonb not null,
  bytes int,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists snapshots_at_idx on public.snapshots(created_at desc);

-- ---------------------------------------------------------------------
-- Triggers: timestamps, owner stamping (no spoofing), history log
-- ---------------------------------------------------------------------
create or replace function private.touch() returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end $fn$;

do $$ declare t text; begin
  foreach t in array array['settings','categories','items','media'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function private.touch()', t, t);
  end loop;
end $$;

-- Whoever is signed in is recorded as the author; the client cannot choose it.
create or replace function private.stamp_owner() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  -- restores and undo keep the original author
  if current_setting('pressio.keep_owner', true) = '1' then return new; end if;
  new.created_by := auth.uid();
  new.created_by_name := (select full_name from public.staff where id = auth.uid());
  new.created_at := now();
  if tg_table_name = 'invoices' and not private.is_admin() then
    new.status := 'pending';
  end if;
  return new;
end $fn$;

do $$ declare t text; begin
  foreach t in array array['invoices','reports','media'] loop
    execute format('drop trigger if exists %I_stamp on public.%I', t, t);
    execute format('create trigger %I_stamp before insert on public.%I for each row execute function private.stamp_owner()', t, t);
  end loop;
end $$;

create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare o jsonb; n jsonb;
begin
  if current_setting('pressio.restoring', true) = '1' then return coalesce(new, old); end if;
  o := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  if tg_op = 'UPDATE' and (o - 'updated_at') = (n - 'updated_at') then return new; end if;
  insert into public.content_history(table_name, row_id, action, old_data, new_data, changed_by, changed_by_name)
  values (tg_table_name, coalesce(n ->> 'id', o ->> 'id', ''), tg_op, o, n, auth.uid(),
          (select full_name from public.staff where id = auth.uid()));
  return coalesce(new, old);
end $fn$;

do $$ declare t text; begin
  foreach t in array array['settings','categories','items','media','staff','invoices','reports'] loop
    execute format('drop trigger if exists %I_log on public.%I', t, t);
    execute format('create trigger %I_log after insert or update or delete on public.%I for each row execute function private.log_change()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.settings        enable row level security;
alter table public.categories      enable row level security;
alter table public.items           enable row level security;
alter table public.media           enable row level security;
alter table public.content_history enable row level security;
alter table public.snapshots       enable row level security;

-- Public menu and site content: anyone can read, only owner/manager can change.
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to anon, authenticated using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for update to authenticated
  using (private.is_editor()) with check (private.is_editor());

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to anon, authenticated using (true);
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for all to authenticated
  using (private.is_editor()) with check (private.is_editor());

drop policy if exists items_read on public.items;
create policy items_read on public.items for select to anon, authenticated using (true);
drop policy if exists items_write on public.items;
create policy items_write on public.items for all to authenticated
  using (private.is_editor()) with check (private.is_editor());

-- Media: photos/videos public; documents only to their uploader and the owner.
drop policy if exists media_read_public on public.media;
create policy media_read_public on public.media for select to anon, authenticated using (kind <> 'docs');
drop policy if exists media_read_docs on public.media;
create policy media_read_docs on public.media for select to authenticated
  using (kind = 'docs' and (created_by = auth.uid() or private.is_admin()));
drop policy if exists media_insert on public.media;
create policy media_insert on public.media for insert to authenticated
  with check (private.is_editor() or (kind = 'docs' and private.is_staff()));
drop policy if exists media_update on public.media;
create policy media_update on public.media for update to authenticated
  using (private.is_editor()) with check (private.is_editor());
drop policy if exists media_delete on public.media;
create policy media_delete on public.media for delete to authenticated
  using ((kind <> 'docs' and private.is_editor()) or private.is_admin());

-- History and snapshots: readable by owner/manager, nobody can edit history.
drop policy if exists history_read on public.content_history;
create policy history_read on public.content_history for select to authenticated using (private.is_editor());
drop policy if exists snapshots_read on public.snapshots;
create policy snapshots_read on public.snapshots for select to authenticated using (private.is_editor());
drop policy if exists snapshots_delete on public.snapshots;
create policy snapshots_delete on public.snapshots for delete to authenticated using (private.is_admin());

-- Invoices / reports: only ACTIVE staff can submit; nothing can be edited after sending.
drop policy if exists inv_own_ins on public.invoices;
create policy inv_own_ins on public.invoices for insert to authenticated
  with check (created_by = auth.uid() and private.is_staff());
drop policy if exists inv_own_sel on public.invoices;
create policy inv_own_sel on public.invoices for select to authenticated
  using (created_by = auth.uid() and private.is_staff());
drop policy if exists inv_admin on public.invoices;
create policy inv_admin on public.invoices for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

drop policy if exists rep_own_ins on public.reports;
create policy rep_own_ins on public.reports for insert to authenticated
  with check (created_by = auth.uid() and private.is_staff());
drop policy if exists rep_own_sel on public.reports;
create policy rep_own_sel on public.reports for select to authenticated
  using (created_by = auth.uid() and private.is_staff());
drop policy if exists rep_fin_sel on public.reports;
create policy rep_fin_sel on public.reports for select to authenticated
  using (private.is_editor());
drop policy if exists rep_admin on public.reports;
create policy rep_admin on public.reports for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- ---------------------------------------------------------------------
-- Storage: 'media' (public photos/videos), 'docs' (private invoices/documents)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media','media', true, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs','docs', false, 20971520,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_obj_read on storage.objects;
create policy media_obj_read on storage.objects for select to anon, authenticated using (bucket_id = 'media');
drop policy if exists media_obj_ins on storage.objects;
create policy media_obj_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and private.is_editor());
drop policy if exists media_obj_upd on storage.objects;
create policy media_obj_upd on storage.objects for update to authenticated
  using (bucket_id = 'media' and private.is_editor());
drop policy if exists media_obj_del on storage.objects;
create policy media_obj_del on storage.objects for delete to authenticated
  using (bucket_id = 'media' and private.is_editor());

-- Documents: each person writes only inside their own folder; no one can delete via the site.
drop policy if exists docs_ins on storage.objects;
create policy docs_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text and private.is_staff());
drop policy if exists docs_sel on storage.objects;
create policy docs_sel on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists docs_sel_admin on storage.objects;
create policy docs_sel_admin on storage.objects for select to authenticated
  using (bucket_id = 'docs' and private.is_admin());

-- ---------------------------------------------------------------------
-- Public read: the whole site in one request
-- ---------------------------------------------------------------------
create or replace function public.get_site()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'v', 2,
    'updated_at', greatest(
        (select updated_at from public.settings where id = 1),
        (select max(updated_at) from public.categories),
        (select max(updated_at) from public.items),
        (select max(updated_at) from public.media)),
    'settings', coalesce((select data - 'report_fields' from public.settings where id = 1), '{}'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en,
        'hours_from', c.hours_from, 'hours_to', c.hours_to) order by c.sort, c.name_en)
      from public.categories c where c.visible), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'c', i.category_id, 'name_ar', i.name_ar, 'name_en', i.name_en,
        'desc_ar', i.desc_ar, 'desc_en', i.desc_en, 'price', i.price,
        'available', i.available, 'featured', i.featured,
        'snooze_until', i.snooze_until, 'images', i.images) order by i.sort)
      from public.items i join public.categories c on c.id = i.category_id
      where not i.hidden and c.visible), '[]'::jsonb),
    'media', coalesce((select jsonb_object_agg(m.id, jsonb_build_object(
        'url', m.url, 'w', m.width, 'h', m.height, 'kind', m.kind,
        'alt_ar', m.alt_ar, 'alt_en', m.alt_en))
      from public.media m where m.kind <> 'docs'), '{}'::jsonb)
  )
$fn$;
grant execute on function public.get_site() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Versions: take / restore / import / revert one change
-- ---------------------------------------------------------------------
create or replace function private.take_snapshot(p_label text, p_kind text, p_uid uuid)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare d jsonb; sid bigint;
begin
  d := jsonb_build_object(
    'format', 'pressio-backup', 'version', 2, 'taken_at', now(),
    'settings',   (select data from public.settings where id = 1),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort) from public.categories c), '[]'::jsonb),
    'items',      coalesce((select jsonb_agg(to_jsonb(i) order by i.category_id, i.sort) from public.items i), '[]'::jsonb),
    'media',      coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.media m where m.kind <> 'docs'), '[]'::jsonb));
  insert into public.snapshots(label, kind, data, bytes, created_by, created_by_name)
  values (coalesce(nullif(p_label,''), 'Version'), p_kind, d, octet_length(d::text), p_uid,
          (select full_name from public.staff where id = p_uid))
  returning id into sid;
  return sid;
end $fn$;

create or replace function public.save_snapshot(p_label text default '')
returns bigint language plpgsql security definer set search_path = public as $fn$
begin
  if not private.is_editor() then raise exception 'not allowed'; end if;
  return private.take_snapshot(p_label, 'manual', auth.uid());
end $fn$;

create or replace function private.apply_snapshot(d jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if d ->> 'format' is distinct from 'pressio-backup' then
    raise exception 'This is not a pressio backup file';
  end if;
  if jsonb_typeof(d -> 'categories') <> 'array' or jsonb_typeof(d -> 'items') <> 'array' then
    raise exception 'Backup is missing categories or items';
  end if;

  perform set_config('pressio.restoring', '1', true);
  perform set_config('pressio.keep_owner', '1', true);

  delete from public.items;
  delete from public.categories;
  delete from public.media where kind <> 'docs';

  insert into public.categories select * from jsonb_populate_recordset(null::public.categories, d -> 'categories');
  insert into public.media      select * from jsonb_populate_recordset(null::public.media, coalesce(d -> 'media', '[]'::jsonb))
    on conflict (id) do nothing;
  insert into public.items      select * from jsonb_populate_recordset(null::public.items, d -> 'items');
  if d ? 'settings' and d -> 'settings' is not null then
    insert into public.settings(id, data) values (1, d -> 'settings')
    on conflict (id) do update set data = excluded.data, updated_at = now();
  end if;

  perform set_config('pressio.restoring', '0', true);
  perform set_config('pressio.keep_owner', '0', true);
  insert into public.content_history(table_name, row_id, action, new_data, changed_by, changed_by_name)
  values ('snapshots', '', 'RESTORE', jsonb_build_object('note', p_note), auth.uid(),
          (select full_name from public.staff where id = auth.uid()));
end $fn$;

create or replace function public.restore_snapshot(p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare d jsonb;
begin
  if not private.is_admin() then raise exception 'Only the owner can restore versions'; end if;
  select data into d from public.snapshots where id = p_id;
  if d is null then raise exception 'Version not found'; end if;
  perform private.take_snapshot('Before restoring #' || p_id, 'pre-restore', auth.uid());
  perform private.apply_snapshot(d, 'Restored version #' || p_id);
end $fn$;

create or replace function public.import_snapshot(p_data jsonb, p_label text default 'Imported file')
returns bigint language plpgsql security definer set search_path = public as $fn$
declare sid bigint;
begin
  if not private.is_admin() then raise exception 'Only the owner can import backups'; end if;
  if p_data ->> 'format' is distinct from 'pressio-backup' then raise exception 'This is not a pressio backup file'; end if;
  perform private.take_snapshot('Before import', 'pre-restore', auth.uid());
  insert into public.snapshots(label, kind, data, bytes, created_by, created_by_name)
  values (p_label, 'import', p_data, octet_length(p_data::text), auth.uid(),
          (select full_name from public.staff where id = auth.uid()))
  returning id into sid;
  perform private.apply_snapshot(p_data, 'Imported ' || p_label);
  return sid;
end $fn$;

-- Undo one change from the history log.
create or replace function public.revert_change(p_history_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare h public.content_history; sets text;
begin
  if not private.is_editor() then raise exception 'not allowed'; end if;
  select * into h from public.content_history where id = p_history_id;
  if h.id is null then raise exception 'Change not found'; end if;
  if h.table_name not in ('settings','categories','items','media') then
    raise exception 'This change cannot be undone from here';
  end if;
  if h.action = 'INSERT' then
    execute format('delete from public.%I where id::text = $1', h.table_name) using h.row_id;
  elsif h.action in ('UPDATE','DELETE') then
    perform set_config('pressio.keep_owner', '1', true);
    select string_agg(format('%I = excluded.%I', k, k), ', ') into sets
    from jsonb_object_keys(h.old_data) k where k <> 'id';
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict (id) do update set %s',
                   h.table_name, h.table_name, sets) using h.old_data;
    perform set_config('pressio.keep_owner', '0', true);
  end if;
end $fn$;

revoke all on function public.save_snapshot(text), public.restore_snapshot(bigint),
  public.import_snapshot(jsonb, text), public.revert_change(bigint) from public, anon;
grant execute on function public.save_snapshot(text), public.restore_snapshot(bigint),
  public.import_snapshot(jsonb, text), public.revert_change(bigint) to authenticated;
revoke all on function private.take_snapshot(text, text, uuid), private.apply_snapshot(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Automatic daily backup on the server (kept 60 days) + history pruning
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('pressio-daily-backup', '0 0 * * *',
    $c$select private.take_snapshot('Daily backup', 'auto', null)$c$);
  perform cron.schedule('pressio-prune', '30 0 * * *',
    $c$delete from public.snapshots where kind in ('auto','pre-restore') and created_at < now() - interval '60 days';
       delete from public.content_history where changed_at < now() - interval '365 days'$c$);
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;
