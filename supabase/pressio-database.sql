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

-- pressio — seed with the current menu and site content (runs only on an empty menu)
do $seed$ begin
if exists (select 1 from public.items) then raise notice 'menu already present — seed skipped'; return; end if;
perform set_config('pressio.restoring','1',true);
insert into public.settings(id,data) values (1,'{"brand": {"tagline": "Speciality Coffee", "foot": "Pause. Sip. Pressio"}, "cur": {"ar": "درهم", "en": "AED"}, "maint": {"on": true, "staff": true, "title": {"ar": "الموقع تحت الصيانة", "en": "We are under maintenance"}, "body": {"ar": "نجهّز تحديثاً سريعاً ونرجع قريباً. المقهى شغّال كالعادة — تقدر تطلب من طلبات أو بينز أو كيتا.", "en": "We are shipping a quick update and will be back shortly. The shop is open as usual — you can still order on talabat, Beans or Keeta."}}, "loyalty": {"url": "https://site.brand-wallet.com/dd398718-91db-4093-ad12-7eb566999d45", "title": {"ar": "كل ٥ مشروبات، السادس علينا", "en": "Every 5 drinks, the 6th is on us"}, "body": {"ar": "بطاقة pressio تنحفظ في محفظة جوالك — ما تحتاج تحملها ولا تخاف تضيع. كل ما تشتري مشروب يضاف لك ستامب، وأول ما تكمل خمسة يوصلك كوبون مشروب مجاني في نفس البطاقة.", "en": "The pressio card lives in your phone wallet — nothing to carry, nothing to lose. Every drink adds a stamp, and the fifth one turns into a free-drink coupon right on the card."}, "cta": {"ar": "انضم للبرنامج", "en": "Join the programme"}, "scan": {"ar": "هذا شكل البطاقة بعد ما تنضم — الستامب يزيد مع كل مشروب", "en": "This is how the card looks once you join — a stamp per drink"}, "steps": [{"ar": "انضم", "en": "Join", "dar": "امسح الكود أو اضغط الزر وسجّل اسمك ورقمك.", "den": "Scan the code or tap the button and enter your name and number."}, {"ar": "أضف البطاقة", "en": "Add the card", "dar": "تنحفظ في Apple Wallet أو Google Wallet بضغطة.", "den": "Saves to Apple Wallet or Google Wallet in one tap."}, {"ar": "اجمع ستامب", "en": "Collect a stamp", "dar": "وريّ البطاقة للكاشير مع كل مشروب.", "den": "Show the card at the till with each drink."}, {"ar": "استلم مشروبك", "en": "Claim your drink", "dar": "خمس ستامبات = كوبون مشروب مجاني.", "den": "Five stamps become a free-drink coupon."}], "qr": "images/loyalty-qr.png", "stamp_full": "stamp-full", "stamp_empty": "stamp-empty"}, "home": {"about": {"ar": "pressio كوفي مختصة في الراشدية بدبي. نحمّص ونحضّر القهوة بنفس الاهتمام الي نحضّر فيه المخبوزات كل صباح، والمكان مصمّم عشان يناسب فنجان سريع قبل الدوام وجلسة شغل طويلة بنفس الدرجة.", "en": "pressio is a speciality coffee house in Rashidiya, Dubai. We treat the brew bar and the bakery with the same care every morning, and the space is built to suit a quick cup before work and a long working session equally well."}, "points": [{"ar": "قهوة مختصة", "en": "Speciality coffee", "dar": "حبوب مختارة، تحضير يدوي، وبار إسبريسو مضبوط كل يوم.", "den": "Selected beans, hand brewing, and an espresso bar dialled in daily."}, {"ar": "مخبوزات طازجة", "en": "Fresh bakery", "dar": "كرواسون وكوكيز وحلا يطلع من المطبخ كل صباح.", "den": "Croissants, cookies and desserts out of the kitchen each morning."}, {"ar": "مساحة تريّح", "en": "A room that works", "dar": "إضاءة طبيعية وطاولات تنفع للشغل وجلسات هادية.", "den": "Natural light and tables that work for laptops and slow mornings."}], "space": [{"img": "int1", "ar": "الجلسة عند النافذة", "en": "The window lounge"}, {"img": "int3", "ar": "البار", "en": "The brew bar"}, {"img": "int4", "ar": "طاولات الشغل", "en": "Work tables"}, {"img": "int2", "ar": "ركن الضوء", "en": "The light corner"}], "gallery": [{"img": "latte", "ar": "فنجان pressio", "en": "The pressio cup"}, {"img": "cookie", "ar": "فدجي براوني كوكيز", "en": "Fudgy Brownie Cookies"}, {"img": "crois", "ar": "كرواسون زعتر", "en": "Za''atar Croissant"}, {"img": "crispy-twist", "ar": "كرسبي تويست", "en": "Crispy Twist"}, {"img": "cake", "ar": "كيك التوت", "en": "Berry Cake"}, {"img": "cup", "ar": "قهوة الصباح", "en": "Morning brew"}], "delivery": [{"ar": "طلبات", "en": "talabat", "dar": "توصيل خلال دقايق", "den": "Delivery in minutes", "url": ""}, {"ar": "بينز", "en": "Beans", "dar": "قهوة مختصة للتوصيل", "den": "Speciality coffee delivery", "url": ""}, {"ar": "كيتا", "en": "Keeta", "dar": "توصيل وطلب مسبق", "den": "Delivery and pre-order", "url": ""}], "info": {"hours": {"ar": "يومياً ٧:٠٠ صباحاً – ١٢:٠٠ منتصف الليل", "en": "Daily 7:00 AM – 12:00 midnight"}, "addr": {"ar": "الراشدية، دبي، الإمارات", "en": "Rashidiya, Dubai, UAE"}, "phone": "050 344 4335", "open_from": 7, "open_to": 24, "ig": "@pressio.ae", "map": "", "whatsapp": ""}, "hero": {"title_ar": "خذ لحظة. ارتشف. pressio", "title_en": "Pause. Sip. Pressio.", "sub_ar": "قهوة مختصة ومخبوزات طازجة كل صباح في الراشدية، دبي.", "sub_en": "Speciality coffee and fresh bakery, every morning in Rashidiya, Dubai.", "image": "hero"}}, "shop": {"on": false, "pay": false, "provider": "none", "outletRef": "", "minOrder": 0, "pickup": true, "delivery": false, "deliveryFee": 0, "prep": 15, "vat": 0.05}, "report_fields": [{"key": "visa", "ar": "فيزا", "en": "Visa", "kind": "amount", "in_sales": true, "group": "card", "active": true}, {"key": "mc", "ar": "ماستركارد", "en": "Mastercard", "kind": "amount", "in_sales": true, "group": "card", "active": true}, {"key": "talabat", "ar": "طلبات", "en": "talabat", "kind": "amount", "in_sales": true, "group": "delivery", "active": true}, {"key": "beans", "ar": "بينز", "en": "Beans", "kind": "amount", "in_sales": true, "group": "delivery", "active": true}, {"key": "keeta", "ar": "كيتا", "en": "Keeta", "kind": "amount", "in_sales": true, "group": "delivery", "active": true}]}'::jsonb) on conflict (id) do update set data = excluded.data;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('beans','menu','','images/beans.webp',420,420,17710,'حبوب ٢٥٠ جرام','Beans — 250g') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('berrycup','menu','','images/berrycup.webp',420,420,17110,'سموذي أساي','Açaí Smoothie') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('berryswirl','menu','','images/berryswirl.webp',420,420,14086,'ميلك شيك فراولة','Strawberry Milkshake') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('biscoff','menu','','images/biscoff.webp',420,420,17958,'فرابيه أوريو','Oreo Frappe') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('cake','menu','','images/cake.webp',420,420,7156,'كيك التوت','Berry Cake') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('caramel','menu','','images/caramel.webp',420,420,12056,'كراميل لاتيه','Caramel Latte') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('cookie','menu','','images/cookie.webp',420,420,13376,'فدجي براوني كوكيز','Fudgy Brownie Cookies') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('crispy-twist','menu','','images/crispy-twist.webp',1200,1200,169018,'كرسبي تويست','Crispy Twist') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('crois','menu','','images/crois.webp',420,420,11664,'كرواسون زعتر','Za''atar Croissant') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('cup','menu','','images/cup.webp',420,420,9624,'قهوة الصباح','Morning brew') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('flatwhite','menu','','images/flatwhite.webp',420,420,8370,'بيكولو','Piccolo') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('hero-800','venue','','images/hero-800.webp',800,824,41210,'مقهى pressio في الراشدية','pressio café in Rashidiya') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('hero','venue','','images/hero.webp',1300,1339,85076,'مقهى pressio في الراشدية','pressio café in Rashidiya') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('hotchoc','menu','','images/hotchoc.webp',420,420,11166,'شوكولاتة ساخنة','Hot Chocolate') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('int1','venue','','images/int1.webp',520,390,23016,'الجلسة عند النافذة','The window lounge') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('int2','venue','','images/int2.webp',520,390,10422,'ركن الضوء','The light corner') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('int3','venue','','images/int3.webp',520,390,33962,'البار','The brew bar') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('int4','venue','','images/int4.webp',520,390,15634,'طاولات الشغل','Work tables') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('latte','menu','','images/latte.webp',420,420,9192,'فنجان pressio','The pressio cup') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('logo','brand','','images/logo.webp',700,186,19732,'شعار pressio','pressio logo') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('mango','menu','','images/mango.webp',420,420,9966,'سموذي موز','Banana Smoothie') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('matchafrappe','menu','','images/matchafrappe.webp',420,420,8432,'ماتشا كلاسيك','Classic Matcha') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('og','brand','','images/og.jpg',1200,630,86430,'','') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('pistachio','menu','','images/pistachio.webp',420,420,15630,'بستاشيو لاتيه ساخن','Hot Pistachio Latte') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('slice','menu','','images/slice.webp',420,420,13932,'كيك شوكولاتة','Chocolate Cake') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('smatcha','menu','','images/smatcha.webp',420,420,15096,'ستروبيري ماتشا','Strawberry Matcha') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('softberry','menu','','images/softberry.webp',420,420,11142,'أفوقاتو','Affogato') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('stamp-empty','brand','','images/stamp-empty.webp',210,220,1334,'','') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('stamp-full','brand','','images/stamp-full.webp',210,220,1744,'','') on conflict (id) do nothing;
insert into public.media(id,kind,folder,url,width,height,bytes,alt_ar,alt_en) values ('twist','menu','','images/twist.webp',420,420,10162,'كرسبي تويست','Crispy Twist') on conflict (id) do nothing;
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('cbrk',0,'الريوق','Breakfast',7,12);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k1','cbrk',0,'كرواسون جبن','Cheese Croissant','','',18,true,false,array['crois']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k2','cbrk',10,'كرواسون زعتر','Za''atar Croissant','زعتر وسمسم','Za''atar and sesame',18,true,false,array['crois']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k3','cbrk',20,'كرواسون سادة','Plain Croissant','طبقات زبدة فرنسية','French butter layers',15,true,false,array['crois']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k4','cbrk',30,'كرواسون لوز','Almond Croissant','','',18,true,false,array['crois']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k5','cbrk',40,'كرواسون شوكولاتة','Chocolate Croissant','','',18,true,false,array['crois']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k6','cbrk',50,'كرواسون جبن وطماطم','Cheese & Tomato Croissant','','',20,true,false,array['crois']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k7','cbrk',60,'كرواسون تركي وجبن','Turkey & Cheese Croissant','','',25,true,false,array['crois']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k8','cbrk',70,'أفوكادو توست','Avocado Toast','أفوكادو مهروس على خبز محمّص','Smashed avocado on toast',28,true,false,array['cake']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k9','cbrk',80,'أفوكادو توست بالدجاج','Chicken Avocado Toast','','',32,true,false,array['cake']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('k10','cbrk',90,'شكشوكة','Shakshuka','بيض بصلصة الطماطم','Eggs in tomato sauce',32,true,false,array['twist']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('ccla',10,'كلاسيك','Classic',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c1','ccla',0,'إسبريسو','Espresso','شوت مركّز','Concentrated shot',19,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c2','ccla',10,'إسبريسو ماكياتو','Espresso Macchiato','لمسة رغوة حليب','A touch of milk foam',20,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c3','ccla',20,'أمريكانو','Americano','إسبريسو مع ماء ساخن','Espresso lengthened with hot water',19,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c4','ccla',30,'بيكولو','Piccolo','لاتيه صغير مركّز','A small, concentrated latte',23,true,false,array['flatwhite']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c5','ccla',40,'كورتادو','Cortado','إسبريسو وحليب بكميات متساوية','Equal parts espresso and milk',24,true,false,array['flatwhite']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c6','ccla',50,'فلات وايت','Flat White','دبل شوت مع حليب مخملي','Double shot, velvet milk',25,true,false,array['flatwhite']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c7','ccla',60,'كابتشينو','Cappuccino','ثلث إسبريسو وثلث حليب وثلث رغوة','Espresso, milk and foam in thirds',25,true,false,array['flatwhite']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c8','ccla',70,'كافيه لاتيه','Café Latte','إسبريسو مع حليب مبخّر','Espresso with steamed milk',25,true,false,array['flatwhite']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('c9','ccla',80,'ديرتي إسبريسو','Dirty Espresso','شوت ساخن فوق حليب بارد','A hot shot poured over cold milk',24,true,false,array['latte']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('chot',20,'سيقنتشر ساخن','Hot Signature',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h1','chot',0,'سبانيش لاتيه ساخن','Hot Spanish Latte','حليب مكثف محلّى','Sweetened condensed milk',28,true,false,array['latte']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h2','chot',10,'كوكونت لاتيه ساخن','Hot Coconut Latte','حليب جوز الهند','Coconut milk',28,true,false,array['latte']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h3','chot',20,'بستاشيو لاتيه ساخن','Hot Pistachio Latte','كريمة الفستق','Pistachio cream',30,true,true,array['pistachio']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h4','chot',30,'شوكولاتة ساخنة','Hot Chocolate','شوكولاتة داكنة مع مارشميلو','Dark chocolate, marshmallows',24,true,false,array['hotchoc']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h5','chot',40,'هوت موكا','Hot Mocha','إسبريسو وشوكولاتة وحليب','Espresso, chocolate, milk',26,true,false,array['hotchoc']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h6','chot',50,'كراميل لاتيه','Caramel Latte','','',26,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h7','chot',60,'زعفران لاتيه ساخن','Hot Saffron Latte','حليب بالزعفران','Saffron-infused milk',30,true,false,array['latte']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h8','chot',70,'كراميل كابتشينو','Caramel Cappuccino','','',28,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('h9','chot',80,'ميلك شيك فراولة','Strawberry Milkshake','','',30,true,false,array['berryswirl']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('ccold',30,'باردة','Cold',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('d1','ccold',0,'أفوقاتو','Affogato','آيس كريم مع شوت إسبريسو','Ice cream under an espresso shot',24,true,false,array['softberry']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('d2','ccold',10,'آيس أمريكانو','Iced Americano','','',20,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('d3','ccold',20,'آيس لاتيه','Iced Latte','','',25,true,false,array['latte']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('d4','ccold',30,'آيس كراميل لاتيه','Iced Caramel Latte','','',28,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('d5','ccold',40,'آيس سبانيش لاتيه','Iced Spanish Latte','حليب مكثف محلّى ومثلج','Condensed milk, iced',28,true,true,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('d6','ccold',50,'آيس تيراميسو','Iced Tiramisu','','',30,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('d7','ccold',60,'آيس كوكونت لاتيه','Iced Coconut Latte','','',28,true,false,array['latte']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('d8','ccold',70,'فرابيه كراميل','Caramel Frappe','مخفوق بارد بصوص الكراميل','Blended cold, caramel sauce',30,true,false,array['caramel']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('csig',40,'سيقنتشر بارد','Cold Signature',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s1','csig',0,'فرابيه بستاشيو','Pistachio Frappe','','',35,true,true,array['pistachio']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s2','csig',10,'ماتشا كلاسيك','Classic Matcha','ماتشا احتفالية مع الحليب','Ceremonial matcha with milk',30,true,false,array['matchafrappe']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s3','csig',20,'كلاود ماتشا','Cloud Matcha','طبقة كريمة فوق الماتشا','A cream cloud over matcha',33,true,true,array['matchafrappe']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s4','csig',30,'آيس كراميل ماكياتو','Iced Caramel Macchiato','','',28,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s5','csig',40,'سموذي أساي','Açaí Smoothie','','',35,true,false,array['berrycup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s6','csig',50,'آيس زعفران لاتيه','Iced Saffron Latte','','',33,true,false,array['latte']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s7','csig',60,'فرابيه أوريو','Oreo Frappe','','',30,true,false,array['biscoff']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s8','csig',70,'سموذي موز','Banana Smoothie','','',28,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s9','csig',80,'فرابيه لوتس','Lotus Frappe','صوص وبسكويت لوتس','Lotus sauce and biscuit',30,true,false,array['biscoff']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s10','csig',90,'بلو كلاود ماتشا','Blue Cloud Matcha','','',35,true,false,array['matchafrappe']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s11','csig',100,'آيس كافيه برتقال','Iced Orange Coffee','برتقال طازج مع الإسبريسو','Fresh orange with espresso',30,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s12','csig',110,'إسبريسو كلاود','Espresso Cloud','','',32,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s13','csig',120,'فرابيه ترافل','Truffle Frappe','','',30,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s14','csig',130,'ستروبيري ماتشا','Strawberry Matcha','طبقة فراولة تحت الماتشا','A strawberry layer under the matcha',34,true,true,array['smatcha']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s15','csig',140,'فرابيه ماتشا','Matcha Frappe','','',34,true,false,array['matchafrappe']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s16','csig',150,'شوكولاتة كلاود إسبريسو','Chocolate Cloud Espresso','','',34,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s17','csig',160,'ديت كلاود ماتشا','Date Cloud Matcha','محلّى بالتمر','Sweetened with dates',36,true,false,array['matchafrappe']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s18','csig',170,'ديت كلاود لاتيه','Date Cloud Latte','محلّى بالتمر','Sweetened with dates',36,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s19','csig',180,'فرابيه فراولة','Strawberry Frappe','','',30,true,false,array['berryswirl']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s20','csig',190,'فرابيه أوركيد','Orchid Frappe','','',32,true,false,array['berryswirl']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s21','csig',200,'كاسكارا','Cascara','مشروب من قشر البن','Brewed from the coffee cherry',27,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s22','csig',210,'كوكتيل طبقات','Cocktail Layer','','',35,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s23','csig',220,'سموذي فراولة وموز','Strawberry Banana Smoothie','','',32,true,false,array['berrycup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s24','csig',230,'آيس ستروبيري ماتشا','Iced Strawberry Matcha','','',35,true,false,array['smatcha']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s25','csig',240,'آيس مانجو ماتشا','Iced Mango Matcha','','',35,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('s26','csig',250,'آيس شاي خوخ وليمون','Iced Peach Lemon Tea','','',25,true,false,array['mango']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('cbrew',50,'تحضير يدوي','Manual Brew',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('m1','cbrew',0,'في ٦٠','V60','حسب حبة اليوم','Today''s single origin',35,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('m2','cbrew',10,'كيمكس','Chemex','يكفي شخصين','Serves two',32,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('m3','cbrew',20,'كولد برو','Cold Brew','منقوع على البارد','Cold steeped',33,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('m4','cbrew',30,'كاليتا','Kalita','','',28,true,false,array['cup']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('cjuice',60,'عصائر وموهيتو','Juices & Mojitos',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j1','cjuice',0,'بريسيو مايلو','Pressio Milo','','',25,true,false,array['caramel']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j2','cjuice',10,'موهيتو فراولة','Strawberry Mojito','','',25,true,false,array['berryswirl']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j3','cjuice',20,'موهيتو باشن فروت','Passion Fruit Mojito','','',25,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j4','cjuice',30,'موهيتو توت أزرق','Blueberry Mojito','','',25,true,false,array['berrycup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j5','cjuice',40,'ليمون ونعناع','Lemon & Mint','','',26,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j6','cjuice',50,'عصير برتقال طازج','Fresh Orange Juice','','',22,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j7','cjuice',60,'سموذي أفوكادو','Avocado Smoothie','','',30,true,false,array['matchafrappe']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j8','cjuice',70,'كركديه','Hibiscus','','',27,true,false,array['berrycup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j9','cjuice',80,'بينا كولادا','Piña Colada','','',35,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('j10','cjuice',90,'فرابيه مانجو','Mango Frappe','','',35,true,false,array['mango']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('ctea',70,'شاي','Tea',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('t1','ctea',0,'شاي إنقليش بريكفست','English Breakfast Tea','','',10,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('t2','ctea',10,'شاي بابونج','Chamomile Tea','','',10,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('t3','ctea',20,'شاي كرز','Cherry Tea','','',12,true,false,array['cup']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('cice',80,'آيس كريم','Ice Cream',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v1','cice',0,'آيس كريم بريسيو سادة','Pressio Ice Cream — Plain','','',18,true,false,array['softberry']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v2','cice',10,'آيس كريم بصوص اللوتس','Pressio Ice Cream — Lotus','','',21,true,false,array['biscoff']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v3','cice',20,'آيس كريم بصوص الشوكولاتة','Pressio Ice Cream — Chocolate','','',21,true,false,array['biscoff']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v4','cice',30,'آيس كريم بصوص الفستق','Pressio Ice Cream — Pistachio','','',21,true,false,array['pistachio']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v5','cice',40,'آيس كريم بصوص التوت الأزرق','Pressio Ice Cream — Blueberry','','',21,true,false,array['berryswirl']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v6','cice',50,'آيس كريم بصوص الباشن','Pressio Ice Cream — Passion Fruit','','',21,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v7','cice',60,'آيس كريم بصوص العسل','Pressio Ice Cream — Honey','','',21,true,false,array['softberry']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v8','cice',70,'آيس كريم بصوص الفراولة','Pressio Ice Cream — Strawberry','','',26,true,false,array['berrycup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('v9','cice',80,'آيس كريم مع فواكه','Ice Cream with Fruit Topping','فواكه طازجة فوق السوفت سيرف','Fresh fruit over soft serve',26,true,false,array['softberry']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('csweet',90,'حلا','Sweets',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w1','csweet',0,'كوكيز شوكولاتة','Chocolate Cookies','طرية من الداخل مع ملح البحر','Fudgy centre, sea salt',12,true,true,array['cookie']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w2','csweet',10,'علبة ميني كوكيز','Mini Chocolate Cookies Box','١٢ حبة','12 pieces',39,true,false,array['cookie']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w3','csweet',20,'كيك شوكولاتة','Chocolate Cake','','',28,true,false,array['slice']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w4','csweet',30,'كيك ليمون وورد','Lemon Rose Cake','','',24,true,false,array['cake']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w5','csweet',40,'كيك فراولة مشكّل','Mixed Strawberry Cake','','',28,true,false,array['cake']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w6','csweet',50,'كيك سان سباستيان','San Sebastián Cake','تشيز كيك محروق','Burnt cheesecake',28,true,false,array['slice']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w7','csweet',60,'كيك كراميل','Caramel Cake','','',29,true,false,array['slice']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w8','csweet',70,'كيك جوز الهند','Pressio Coconut Cake','','',33,true,false,array['cake']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w9','csweet',80,'كيك لندن','London Cake','','',28,true,false,array['slice']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w10','csweet',90,'بودينق موز','Banana Pudding','','',33,true,false,array['twist']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w11','csweet',100,'عصيدة التمر','Aseeda Date Velvet','','',29,true,false,array['twist']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w12','csweet',110,'حلوى','Halwa','','',22,true,false,array['twist']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w13','csweet',120,'براوني لوتس','Lotus Brownie','','',18,true,false,array['biscoff']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w14','csweet',130,'براوني شوكولاتة','Chocolate Brownie','','',18,true,false,array['cookie']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w15','csweet',140,'براوني تيرتل','Turtle Brownie','','',22,true,false,array['cookie']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w16','csweet',150,'ميني تشيز كيك','Mini Cheesecake','','',10,true,false,array['cake']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w17','csweet',160,'بول أساي — صغير','Açaí Bowl — Small','','',42,true,false,array['berrycup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w18','csweet',170,'بول أساي — كبير','Açaí Bowl — Large','','',50,true,false,array['berrycup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w19','csweet',180,'كول-إيد أناناس وكرز','Kool-Aid Pineapple & Cherry','','',15,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w20','csweet',190,'كول-إيد أناناس وتوت مشكّل','Kool-Aid Pineapple & Mixed Berry','','',20,true,false,array['berrycup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('w21','csweet',200,'كول-إيد أناناس وتوت أزرق','Kool-Aid Pineapple & Blue Raspberry','','',15,true,false,array['berryswirl']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('csoft',100,'مياه ومشروبات غازية','Water & Soft Drinks',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('f1','csoft',0,'ماء','Water','','',11,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('f2','csoft',10,'ماء فوار','Sparkling Water','','',12,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('f3','csoft',20,'ماء فوار بجوز الهند','Sparkling Water — Coconut FRIO','','',12,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('f4','csoft',30,'ماء فوار بالمانجو','Sparkling Water — Mango FRIO','','',12,true,false,array['mango']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('f5','csoft',40,'ماء فوار بالفراولة','Sparkling Water — Strawberry FRIO','','',12,true,false,array['berryswirl']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('f6','csoft',50,'كوكاكولا','Coca-Cola','','',8,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('f7','csoft',60,'كوكاكولا زيرو','Coca-Cola Zero','','',8,true,false,array['cup']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('f8','csoft',70,'سفن أب','7-Up','','',8,true,false,array['cup']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('cbeans',110,'حبوب للبيت','Beans',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('b1','cbeans',0,'حبوب ٢٥٠ جرام','Beans — 250g','','',82,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('b2','cbeans',10,'حبوب ٥٠٠ جرام','Beans — 500g','','',165,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('b3','cbeans',20,'حبوب ١ كيلو','Beans — 1kg','','',330,true,false,array['beans']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('cbones',120,'بونز كوفي','Bones Coffee',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('n1','cbones',0,'ووكي كوكي','Wookiee Cookie','','',37,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('n2','cbones',10,'فرنش فانيلا','French Vanilla','','',37,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('n3','cbones',20,'هولي كانولي','Holy Cannoli','','',37,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('n4','cbones',30,'سينامون رول','Cinnamon Roll','','',37,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('n5','cbones',40,'بلوبيري بلاست','Blueberry Blast','','',37,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('n6','cbones',50,'فرنش توست','French Toast','','',37,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('n7','cbones',60,'آرمي أوف دارك تشوكليت','Army of Dark Chocolate','','',37,true,false,array['beans']::text[]);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('n8','cbones',70,'كولومبيا سنقل أوريجن','Colombia Single Origin','','',37,true,false,array['beans']::text[]);
insert into public.categories(id,sort,name_ar,name_en,hours_from,hours_to) values ('cbox',130,'صندوق الضيافة','Gathering Box',null,null);
insert into public.items(id,category_id,sort,name_ar,name_en,desc_ar,desc_en,price,available,featured,images) values ('g1','cbox',0,'صندوق الضيافة — مشروبات','Gathering Box — Drinks','للاجتماعات والمناسبات','For meetings and gatherings',225,true,false,array['caramel']::text[]);
perform set_config('pressio.restoring','0',true);
perform private.take_snapshot('Initial import from the old site','manual',null);
end $seed$;

-- pressio — health check. Every row should say true.
select 'الجداول التسعة موجودة' as "الفحص", (select count(*) from information_schema.tables where table_schema = 'public'
        and table_name in ('settings','categories','items','media','content_history','snapshots','invoices','reports','staff')) = 9 as "سليم"
union all select 'أصناف المنيو انتقلت (129+)', (select count(*) from public.items) >= 129
union all select 'الأقسام انتقلت (14+)', (select count(*) from public.categories) >= 14
union all select 'الصور مسجّلة في المكتبة', (select count(*) from public.media) >= 30
union all select 'أول نسخة احتياطية محفوظة', (select count(*) from public.snapshots) >= 1
union all select 'النسخ اليومية التلقائية (pg_cron)', exists (select 1 from pg_extension where extname = 'pg_cron')
union all select 'حسابك مالك ومفعّل', exists (select 1 from public.staff where role = 'admin' and active)
union all select 'الحماية RLS مفعّلة على كل الجداول', (select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and relname in ('settings','categories','items','media','snapshots','content_history','invoices','reports','staff'))
union all select 'التسجيل الجديد يدخل موقوف', (select column_default from information_schema.columns where table_schema='public' and table_name='staff' and column_name='active') = 'false';
