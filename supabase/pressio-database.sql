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


-- ===================== v3: roles & permissions =====================
-- =====================================================================
-- pressio — roles & permissions v3
-- Owner adds people from the admin panel and ticks what each one can do.
--   view_all     اطلاع على كل شي (قراءة فقط)
--   site         تعديل المنيو والصور ومحتوى الموقع
--   stock        إخفاء صنف خلص مؤقتاً / إرجاعه
--   inv_upload   رفع الفواتير والتقرير اليومي
--   inv_review   كل الفواتير + قبول ورفض
--   reports      الاطلاع على كل التقارير اليومية
--   backups      حفظ واسترجاع النسخ والتراجع عن التعديلات
-- The owner (role = admin) can do everything and is the only one who manages the team.
-- Safe to run more than once. Nothing is deleted.
-- =====================================================================

select private.take_snapshot('Before roles & permissions update', 'manual', null);

alter table public.staff add column if not exists perms text[] not null default '{}';
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('staff','accountant','manager','admin'));

-- existing people keep what they could do before
update public.staff set perms = array['view_all','site','stock','reports','backups','inv_upload']
 where role = 'manager' and perms = '{}';
update public.staff set perms = array['inv_upload','stock']
 where role = 'staff' and perms = '{}';

alter table public.invoices add column if not exists reviewed_by uuid;
alter table public.invoices add column if not exists reviewed_by_name text;
alter table public.invoices add column if not exists reviewed_at timestamptz;

-- ---------------------------------------------------------------------
-- permission helpers
-- ---------------------------------------------------------------------
create or replace function private.can(p text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select s.role = 'admin' or p = any(s.perms)
                     from public.staff s where s.id = auth.uid() and s.active), false)
$fn$;
create or replace function private.is_editor() returns boolean
language sql stable security definer set search_path = public as $fn$ select private.can('site') $fn$;
grant execute on function private.can(text), private.is_editor() to anon, authenticated;

-- ---------------------------------------------------------------------
-- policies that change
-- ---------------------------------------------------------------------
drop policy if exists media_read_docs on public.media;
create policy media_read_docs on public.media for select to authenticated
  using (kind = 'docs' and (created_by = auth.uid() or private.can('inv_review') or private.can('view_all')));

drop policy if exists history_read on public.content_history;
create policy history_read on public.content_history for select to authenticated
  using (private.can('site') or private.can('backups') or private.can('view_all'));
drop policy if exists snapshots_read on public.snapshots;
create policy snapshots_read on public.snapshots for select to authenticated
  using (private.can('site') or private.can('backups') or private.can('view_all'));

drop policy if exists inv_own_ins on public.invoices;
create policy inv_own_ins on public.invoices for insert to authenticated
  with check (created_by = auth.uid() and private.can('inv_upload'));
drop policy if exists inv_all_sel on public.invoices;
create policy inv_all_sel on public.invoices for select to authenticated
  using (private.can('inv_review') or private.can('view_all'));

drop policy if exists rep_own_ins on public.reports;
create policy rep_own_ins on public.reports for insert to authenticated
  with check (created_by = auth.uid() and private.can('inv_upload'));
drop policy if exists rep_fin_sel on public.reports;
create policy rep_fin_sel on public.reports for select to authenticated
  using (private.can('reports') or private.can('view_all'));

drop policy if exists docs_sel_admin on storage.objects;
create policy docs_sel_admin on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (private.can('inv_review') or private.can('view_all')));

-- ---------------------------------------------------------------------
-- narrow actions (people get exactly this, not full edit rights)
-- ---------------------------------------------------------------------
-- mark an item finished / back, optionally until a time (it comes back by itself)
create or replace function public.set_item_stock(p_id text, p_available boolean, p_until timestamptz default null)
returns public.items language plpgsql security definer set search_path = public as $fn$
declare r public.items;
begin
  if not (private.can('stock') or private.can('site')) then raise exception 'not allowed'; end if;
  if p_until is not null and (p_until < now() or p_until > now() + interval '30 days') then
    raise exception 'pick a time within the next 30 days';
  end if;
  update public.items set available = case when p_until is not null then true else p_available end,
                          snooze_until = p_until
   where id = p_id returning * into r;
  if r.id is null then raise exception 'item not found'; end if;
  return r;
end $fn$;

-- accountant / owner approves or rejects; amounts and files stay untouched
create or replace function public.review_invoice(p_id uuid, p_status text, p_note text default null)
returns public.invoices language plpgsql security definer set search_path = public as $fn$
declare r public.invoices;
begin
  if not private.can('inv_review') then raise exception 'not allowed'; end if;
  if p_status not in ('pending','approved','rejected') then raise exception 'bad status'; end if;
  update public.invoices set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
         reviewed_by_name = (select full_name from public.staff where id = auth.uid()),
         notes = case when coalesce(p_note,'') = '' then notes
                      else concat_ws(' · ', nullif(notes,''), p_note) end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'invoice not found'; end if;
  return r;
end $fn$;

-- backups: owner or people with the backups permission
create or replace function public.save_snapshot(p_label text default '')
returns bigint language plpgsql security definer set search_path = public as $fn$
begin
  if not (private.can('backups') or private.can('site')) then raise exception 'not allowed'; end if;
  return private.take_snapshot(p_label, 'manual', auth.uid());
end $fn$;

do $$ declare src text; begin
  -- restore / undo: allow the backups permission as well as the owner
  select pg_get_functiondef('public.restore_snapshot(bigint)'::regprocedure) into src;
  src := replace(src, 'if not private.is_admin() then', 'if not (private.is_admin() or private.can(''backups'')) then');
  execute src;
  select pg_get_functiondef('public.revert_change(bigint)'::regprocedure) into src;
  src := replace(src, 'if not private.is_editor() then', 'if not (private.can(''site'') or private.can(''backups'')) then');
  execute src;
end $$;

revoke all on function public.set_item_stock(text, boolean, timestamptz), public.review_invoice(uuid, text, text) from public, anon;
grant execute on function public.set_item_stock(text, boolean, timestamptz), public.review_invoice(uuid, text, text) to authenticated;

-- check
select role, count(*) as people, string_agg(distinct array_to_string(perms, ','), ' | ') as perms
  from public.staff group by role order by role;


-- ===================== v4: people & payroll =====================
-- =====================================================================
-- pressio — people & payroll (v4)
--   employees      personal file for each employee, with a running number (PR-001…)
--   payslips       monthly salary receipts (additions / deductions), cannot be edited once issued
--   certificates   salary certificates (English / Arabic), cannot be edited once issued
--   doc_templates  the printable templates (receipt / certificate); the owner can upload new ones
--   hr_settings    company name / signatory used on documents
-- Only the owner and people with the "hr" permission can see any of this.
-- An employee linked to a login can later see ONLY his own file and receipts.
-- Safe to run more than once. Nothing is deleted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  emp_no int generated always as identity (start with 1) unique,
  code text generated always as ('PR-' || lpad(emp_no::text, 3, '0')) stored,
  full_name_en text not null default '',
  full_name_ar text not null default '',
  gender text check (gender in ('male','female')),
  birth_date date,
  nationality_en text not null default '',
  nationality_ar text not null default '',
  passport_no text not null default '',
  passport_expiry date,
  id_no text not null default '',
  job_title_en text not null default '',
  job_title_ar text not null default '',
  department text not null default '',
  join_date date,
  phone text not null default '',
  email text not null default '',
  basic_salary numeric(12,2) not null default 0 check (basic_salary >= 0),
  housing_allowance numeric(12,2) not null default 0 check (housing_allowance >= 0),
  transport_allowance numeric(12,2) not null default 0 check (transport_allowance >= 0),
  other_allowance numeric(12,2) not null default 0 check (other_allowance >= 0),
  status text not null default 'active' check (status in ('active','left')),
  leave_date date,
  notes text not null default '',
  user_id uuid unique references auth.users(id) on delete set null,
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.doc_templates (
  id text primary key default gen_random_uuid()::text,
  kind text not null check (kind in ('receipt','certificate')),
  lang text not null default 'en' check (lang in ('en','ar')),
  name text not null default '',
  page jsonb not null,                 -- {"w":595.3,"h":841.9} in PDF points
  bg_url text,                         -- background image (from a PDF template)
  bg_html text,                        -- or a built-in design (used for the Arabic certificate)
  fields jsonb not null default '{}',  -- {"employee_name":{"x":..,"y":..,"w":..,"h":..,"size":9}, ...}
  active boolean not null default true,
  is_default boolean not null default false,
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  seq int generated always as identity (start with 1) unique,
  receipt_no text generated always as ('SR-' || lpad(seq::text, 5, '0')) stored,
  employee_id uuid not null references public.employees(id) on delete restrict,
  month date not null,                 -- first day of the salary month
  period_from date, period_to date,
  receipt_date date not null default current_date,
  lines jsonb not null default '[]',   -- [{"label":"الراتب الأساسي","amount":3000,"type":"add"}, {"label":"سلفة","amount":200,"type":"deduct"}]
  total numeric(12,2) not null default 0,
  words_en text not null default '', words_ar text not null default '',
  being_for text not null default '',
  notes text not null default '',
  template_id text references public.doc_templates(id) on delete set null,
  emp jsonb not null default '{}',     -- copy of the employee details at the time of issue
  status text not null default 'issued' check (status in ('issued','void')),
  void_reason text, voided_by_name text, voided_at timestamptz,
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists payslips_emp_idx on public.payslips(employee_id, month desc);
create index if not exists payslips_month_idx on public.payslips(month desc);

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  seq int generated always as identity (start with 1) unique,
  cert_no text generated always as ('SC-' || lpad(seq::text, 5, '0')) stored,
  employee_id uuid not null references public.employees(id) on delete restrict,
  lang text not null default 'en' check (lang in ('en','ar')),
  cert_date date not null default current_date,
  recipient_name text not null default '',
  recipient_entity text not null default '',
  purpose text not null default '',
  template_id text references public.doc_templates(id) on delete set null,
  data jsonb not null default '{}',    -- every value printed on the certificate
  status text not null default 'issued' check (status in ('issued','void')),
  void_reason text, voided_by_name text, voided_at timestamptz,
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists certificates_emp_idx on public.certificates(employee_id, created_at desc);

create table if not exists public.hr_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_backups (
  id bigserial primary key,
  data jsonb not null,
  bytes int,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- triggers: timestamps, author stamping, history, totals
-- ---------------------------------------------------------------------
drop trigger if exists employees_touch on public.employees;
create trigger employees_touch before update on public.employees for each row execute function private.touch();
drop trigger if exists hr_settings_touch on public.hr_settings;
create trigger hr_settings_touch before update on public.hr_settings for each row execute function private.touch();

create or replace function private.stamp_author() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  new.created_by := auth.uid();
  new.created_by_name := (select full_name from public.staff where id = auth.uid());
  new.created_at := now();
  return new;
end $fn$;
do $$ declare t text; begin
  foreach t in array array['employees','payslips','certificates','doc_templates'] loop
    execute format('drop trigger if exists %I_author on public.%I', t, t);
    execute format('create trigger %I_author before insert on public.%I for each row execute function private.stamp_author()', t, t);
  end loop;
  foreach t in array array['employees','payslips','certificates','doc_templates','hr_settings'] loop
    execute format('drop trigger if exists %I_log on public.%I', t, t);
    execute format('create trigger %I_log after insert or update or delete on public.%I for each row execute function private.log_change()', t, t);
  end loop;
end $$;

-- the total is always computed by the database from the lines (the page cannot send a wrong total)
create or replace function private.payslip_total() returns trigger
language plpgsql as $fn$
declare t numeric := 0; l jsonb;
begin
  if jsonb_typeof(new.lines) <> 'array' then raise exception 'lines must be a list'; end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    if coalesce((l->>'amount')::numeric, 0) < 0 then raise exception 'amounts must be positive'; end if;
    t := t + case when l->>'type' = 'deduct' then -1 else 1 end * coalesce((l->>'amount')::numeric, 0);
  end loop;
  new.total := round(t, 2);
  new.month := date_trunc('month', new.month)::date;
  -- copy of the employee at the time of issue
  new.emp := (select to_jsonb(e) - 'notes' - 'user_id' - 'created_by' - 'created_by_name' - 'created_at' - 'updated_at'
                from public.employees e where e.id = new.employee_id);
  new.status := 'issued'; new.void_reason := null; new.voided_by_name := null; new.voided_at := null;
  return new;
end $fn$;
drop trigger if exists payslips_total on public.payslips;
create trigger payslips_total before insert on public.payslips for each row execute function private.payslip_total();

create or replace function private.certificate_clean() returns trigger
language plpgsql as $fn$
begin
  new.status := 'issued'; new.void_reason := null; new.voided_by_name := null; new.voided_at := null;
  -- the stored copy carries its own final number
  new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object('cert_no',
    case when new.lang = 'ar' then 'رقم: ' else 'Ref: ' end || 'SC-' || lpad(new.seq::text, 5, '0'));
  return new;
end $fn$;
drop trigger if exists certificates_clean on public.certificates;
create trigger certificates_clean before insert on public.certificates for each row execute function private.certificate_clean();

-- ---------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------
alter table public.employees     enable row level security;
alter table public.payslips      enable row level security;
alter table public.certificates  enable row level security;
alter table public.doc_templates enable row level security;
alter table public.hr_settings   enable row level security;
alter table public.hr_backups    enable row level security;

drop policy if exists emp_hr_sel on public.employees;
create policy emp_hr_sel on public.employees for select to authenticated using (private.can('hr'));
drop policy if exists emp_self_sel on public.employees;
create policy emp_self_sel on public.employees for select to authenticated using (user_id = auth.uid() and private.is_staff());
drop policy if exists emp_hr_ins on public.employees;
create policy emp_hr_ins on public.employees for insert to authenticated with check (private.can('hr'));
drop policy if exists emp_hr_upd on public.employees;
create policy emp_hr_upd on public.employees for update to authenticated using (private.can('hr')) with check (private.can('hr'));
-- no delete policy: an employee who leaves is marked "left", never erased

drop policy if exists ps_hr_sel on public.payslips;
create policy ps_hr_sel on public.payslips for select to authenticated using (private.can('hr'));
drop policy if exists ps_self_sel on public.payslips;
create policy ps_self_sel on public.payslips for select to authenticated
  using (status = 'issued' and private.is_staff() and exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid()));
drop policy if exists ps_hr_ins on public.payslips;
create policy ps_hr_ins on public.payslips for insert to authenticated with check (private.can('hr'));

drop policy if exists ct_hr_sel on public.certificates;
create policy ct_hr_sel on public.certificates for select to authenticated using (private.can('hr'));
drop policy if exists ct_self_sel on public.certificates;
create policy ct_self_sel on public.certificates for select to authenticated
  using (status = 'issued' and private.is_staff() and exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid()));
drop policy if exists ct_hr_ins on public.certificates;
create policy ct_hr_ins on public.certificates for insert to authenticated with check (private.can('hr'));

drop policy if exists tpl_sel on public.doc_templates;
create policy tpl_sel on public.doc_templates for select to authenticated using (private.is_staff());
drop policy if exists tpl_admin on public.doc_templates;
create policy tpl_admin on public.doc_templates for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists hrs_sel on public.hr_settings;
create policy hrs_sel on public.hr_settings for select to authenticated using (private.is_staff());
drop policy if exists hrs_upd on public.hr_settings;
create policy hrs_upd on public.hr_settings for update to authenticated using (private.can('hr')) with check (private.can('hr'));

drop policy if exists hrb_sel on public.hr_backups;
create policy hrb_sel on public.hr_backups for select to authenticated using (private.is_admin());

-- the change log must not show salaries / passports to people without the hr permission
drop policy if exists history_read on public.content_history;
create policy history_read on public.content_history for select to authenticated
  using ((private.can('site') or private.can('backups') or private.can('view_all') or private.can('hr'))
         and (table_name not in ('employees','payslips','certificates','doc_templates','hr_settings') or private.can('hr')));

-- ---------------------------------------------------------------------
-- actions
-- ---------------------------------------------------------------------
-- cancel a receipt / certificate: it stays on record, marked as cancelled, with the reason
create or replace function public.void_hr_doc(p_kind text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare nm text := (select full_name from public.staff where id = auth.uid());
begin
  if not private.can('hr') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'write the reason'; end if;
  if p_kind = 'payslip' then
    update public.payslips set status = 'void', void_reason = p_reason, voided_by_name = nm, voided_at = now()
     where id = p_id and status = 'issued';
  elsif p_kind = 'certificate' then
    update public.certificates set status = 'void', void_reason = p_reason, voided_by_name = nm, voided_at = now()
     where id = p_id and status = 'issued';
  else raise exception 'bad kind'; end if;
  if not found then raise exception 'not found or already cancelled'; end if;
end $fn$;

-- people who can sign in (to link an employee file to his login)
create or replace function public.staff_accounts()
returns table(id uuid, full_name text, email text) language sql stable security definer set search_path = public as $fn$
  select s.id, s.full_name, s.email from public.staff s where private.can('hr') order by s.full_name
$fn$;

-- daily copy of all people & payroll data (owner can download it from the admin panel)
create or replace function private.take_hr_backup() returns bigint
language plpgsql security definer set search_path = public as $fn$
declare d jsonb; bid bigint;
begin
  d := jsonb_build_object('format','pressio-hr-backup','taken_at', now(),
    'employees',    coalesce((select jsonb_agg(to_jsonb(e) order by e.emp_no) from public.employees e), '[]'),
    'payslips',     coalesce((select jsonb_agg(to_jsonb(p) order by p.seq) from public.payslips p), '[]'),
    'certificates', coalesce((select jsonb_agg(to_jsonb(c) order by c.seq) from public.certificates c), '[]'),
    'templates',    coalesce((select jsonb_agg(to_jsonb(t)) from public.doc_templates t), '[]'),
    'settings',     (select data from public.hr_settings where id = 1));
  insert into public.hr_backups(data, bytes) values (d, octet_length(d::text)) returning id into bid;
  delete from public.hr_backups where created_at < now() - interval '90 days';
  return bid;
end $fn$;
create or replace function public.save_hr_backup() returns bigint
language plpgsql security definer set search_path = public as $fn$
begin
  if not private.is_admin() then raise exception 'not allowed'; end if;
  return private.take_hr_backup();
end $fn$;

revoke all on function public.void_hr_doc(text, uuid, text), public.staff_accounts(), public.save_hr_backup() from public, anon;
grant execute on function public.void_hr_doc(text, uuid, text), public.staff_accounts(), public.save_hr_backup() to authenticated;
revoke all on function private.take_hr_backup() from public, anon, authenticated;

do $$
begin
  perform cron.schedule('pressio-hr-backup', '10 0 * * *', $c$select private.take_hr_backup()$c$);
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- defaults
-- ---------------------------------------------------------------------
insert into public.hr_settings(id, data) values (1, jsonb_build_object(
  'company_en', 'Pressio Cafe LLC',
  'company_ar', 'بريسيو كافيه ذ.م.م',
  'address_en', 'Q1 Mall, Al Warqa, Dubai, UAE',
  'address_ar', 'مول Q1، الورقاء، دبي، الإمارات',
  'phone', '(04) 570 3004',
  'signatory_ar', 'طارق عبدالرحيم عمر محمد البناي',
  'signatory_title_ar', 'المدير العام',
  'departments', jsonb_build_array('الخدمة', 'البار', 'المطبخ', 'الإدارة')
)) on conflict (id) do nothing;
-- ---------------------------------------------------------------------
-- default templates (from the fillable PDFs + a matching Arabic certificate)
-- ---------------------------------------------------------------------
insert into public.doc_templates(id, kind, lang, name, page, bg_url, bg_html, fields, active, is_default) values ('receipt-en', 'receipt', 'en', $tpl$إيصال راتب — القالب الأساسي$tpl$, $tpl${"w": 792, "h": 612}$tpl$::jsonb, $tpl$images/templates/receipt-en.png$tpl$, null, $tpl${"receipt_no": {"x": 132.0, "y": 142.0, "w": 105.0, "h": 18.0, "size": 10.0}, "receipt_date": {"x": 607.0, "y": 142.0, "w": 125.0, "h": 18.0, "size": 10.0}, "employee_name": {"x": 151.0, "y": 238.0, "w": 285.0, "h": 18.0, "size": 10.0}, "salary_month": {"x": 560.0, "y": 238.0, "w": 172.0, "h": 18.0, "size": 10.0}, "id_passport": {"x": 155.0, "y": 276.0, "w": 281.0, "h": 18.0, "size": 10.0}, "period_from": {"x": 518.0, "y": 276.0, "w": 82.0, "h": 18.0, "size": 10.0}, "period_to": {"x": 624.0, "y": 276.0, "w": 108.0, "h": 18.0, "size": 10.0}, "job_title": {"x": 112.0, "y": 314.0, "w": 324.0, "h": 18.0, "size": 10.0}, "department": {"x": 550.0, "y": 314.0, "w": 182.0, "h": 18.0, "size": 10.0}, "amount_aed": {"x": 118.0, "y": 365.0, "w": 205.0, "h": 22.0, "size": 11.0}, "amount_in_words": {"x": 433.0, "y": 365.0, "w": 300.0, "h": 22.0, "size": 10.0}, "being_for": {"x": 126.0, "y": 416.0, "w": 607.0, "h": 38.0, "size": 10.0, "multi": true}}$tpl$::jsonb, true, true)
  on conflict (id) do update set page = excluded.page, bg_url = excluded.bg_url, bg_html = excluded.bg_html, fields = excluded.fields, name = excluded.name;
insert into public.doc_templates(id, kind, lang, name, page, bg_url, bg_html, fields, active, is_default) values ('certificate-en', 'certificate', 'en', $tpl$شهادة راتب — إنجليزي$tpl$, $tpl${"w": 595.28, "h": 841.89}$tpl$::jsonb, $tpl$images/templates/certificate-en.png$tpl$, null, $tpl${"certificate_date": {"x": 42.0, "y": 158.0, "w": 246.6, "h": 16.0, "size": 9.0}, "recipient_name": {"x": 306.6, "y": 158.0, "w": 246.6, "h": 16.0, "size": 9.0}, "recipient_entity": {"x": 42.0, "y": 198.0, "w": 246.6, "h": 16.0, "size": 9.0}, "employee_name": {"x": 306.6, "y": 198.0, "w": 246.6, "h": 16.0, "size": 9.0}, "nationality": {"x": 42.0, "y": 238.0, "w": 246.6, "h": 16.0, "size": 9.0}, "passport_id": {"x": 306.6, "y": 238.0, "w": 246.6, "h": 16.0, "size": 9.0}, "job_title": {"x": 42.0, "y": 278.0, "w": 246.6, "h": 16.0, "size": 9.0}, "employment_start_date": {"x": 306.6, "y": 278.0, "w": 246.6, "h": 16.0, "size": 9.0}, "basic_salary": {"x": 375.0, "y": 376.0, "w": 174.3, "h": 20.0, "size": 9.0, "align": "right"}, "housing_allowance": {"x": 375.0, "y": 404.0, "w": 174.3, "h": 20.0, "size": 9.0, "align": "right"}, "transport_allowance": {"x": 375.0, "y": 432.0, "w": 174.3, "h": 20.0, "size": 9.0, "align": "right"}, "other_allowance": {"x": 375.0, "y": 460.0, "w": 174.3, "h": 20.0, "size": 9.0, "align": "right"}, "total_salary": {"x": 375.0, "y": 488.0, "w": 174.3, "h": 20.0, "size": 9.0, "align": "right", "bold": true}, "salary_in_words": {"x": 42.0, "y": 535.0, "w": 511.3, "h": 16.0, "size": 9.0}, "certificate_purpose": {"x": 42.0, "y": 577.0, "w": 511.3, "h": 16.0, "size": 9.0}, "cert_no": {"x": 42, "y": 110, "w": 180, "h": 12, "size": 7.5, "color": "#8E7A6B"}}$tpl$::jsonb, true, true)
  on conflict (id) do update set page = excluded.page, bg_url = excluded.bg_url, bg_html = excluded.bg_html, fields = excluded.fields, name = excluded.name;
insert into public.doc_templates(id, kind, lang, name, page, bg_url, bg_html, fields, active, is_default) values ('certificate-ar', 'certificate', 'ar', $tpl$شهادة راتب — عربي$tpl$, $tpl${"w": 595.28, "h": 841.89}$tpl$::jsonb, null, $tpl$<div style="position:absolute;inset:0;direction:rtl;font-family:'IBM Plex Sans Arabic',sans-serif;color:#3F322B"><div style="position:absolute;left:18pt;top:18pt;width:559pt;height:806pt;border:1pt solid #3F322B;border-radius:6pt"></div><img src="images/templates/logo-llc.png" alt="" style="position:absolute;right:42pt;top:44pt;width:142pt"><div style="position:absolute;left:42pt;top:50pt;width:260pt;text-align:left;direction:rtl"><div style="font-size:9.5pt;font-weight:600">{{address_ar}}</div><div style="font-size:8pt;margin-top:3pt">هاتف: <span dir="ltr">{{phone}}</span></div></div><div style="position:absolute;left:42pt;top:104pt;width:511pt;border-top:1.2pt solid #3F322B"></div><div style="position:absolute;left:42pt;top:116pt;width:511pt;text-align:center;font-size:16pt;font-weight:600">شهادة راتب</div><div style="position:absolute;left:303.6pt;top:145pt;width:252.6pt;font-size:8pt;font-weight:600;color:#3F322B;text-align:right">تاريخ الشهادة</div><div style="position:absolute;left:303.6pt;top:157pt;width:252.6pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:39pt;top:145pt;width:252.6pt;font-size:8pt;font-weight:600;color:#3F322B;text-align:right">إلى / التحية</div><div style="position:absolute;left:39pt;top:157pt;width:252.6pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:303.6pt;top:185pt;width:252.6pt;font-size:8pt;font-weight:600;color:#3F322B;text-align:right">الجهة الموجّهة إليها</div><div style="position:absolute;left:303.6pt;top:197pt;width:252.6pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:39pt;top:185pt;width:252.6pt;font-size:8pt;font-weight:600;color:#3F322B;text-align:right">اسم الموظف</div><div style="position:absolute;left:39pt;top:197pt;width:252.6pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:303.6pt;top:225pt;width:252.6pt;font-size:8pt;font-weight:600;color:#3F322B;text-align:right">الجنسية</div><div style="position:absolute;left:303.6pt;top:237pt;width:252.6pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:39pt;top:225pt;width:252.6pt;font-size:8pt;font-weight:600;color:#3F322B;text-align:right">رقم الجواز / الهوية</div><div style="position:absolute;left:39pt;top:237pt;width:252.6pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:303.6pt;top:265pt;width:252.6pt;font-size:8pt;font-weight:600;color:#3F322B;text-align:right">المسمى الوظيفي</div><div style="position:absolute;left:303.6pt;top:277pt;width:252.6pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:39pt;top:265pt;width:252.6pt;font-size:8pt;font-weight:600;color:#3F322B;text-align:right">تاريخ الالتحاق بالعمل</div><div style="position:absolute;left:39pt;top:277pt;width:252.6pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:42pt;top:311pt;width:511pt;font-size:9pt;line-height:1.6;text-align:right">تشهد {{company_ar}} بأن الموظف المذكور بياناته أعلاه يعمل لديها ولا يزال على رأس عمله، وأن راتبه الشهري الحالي كالتالي:</div><div style="position:absolute;left:42pt;top:344pt;width:511pt;height:26pt;background:#3F322B;color:#fff;font-size:8.5pt;font-weight:600"><span style="position:absolute;right:10pt;top:7pt">بند الراتب</span><span style="position:absolute;left:10pt;top:7pt">المبلغ الشهري بالدرهم</span></div><div style="position:absolute;left:42pt;top:372pt;width:511pt;height:28pt;background:#fff;border:.6pt solid #8E7A6B;border-top:0;box-sizing:border-box"><div style="position:absolute;left:182pt;top:0;bottom:0;border-left:.6pt solid #8E7A6B"></div><span style="position:absolute;right:10pt;top:8pt;font-size:8.5pt;font-weight:400">الراتب الأساسي</span></div><div style="position:absolute;left:42pt;top:400pt;width:511pt;height:28pt;background:#F6F1EB;border:.6pt solid #8E7A6B;border-top:0;box-sizing:border-box"><div style="position:absolute;left:182pt;top:0;bottom:0;border-left:.6pt solid #8E7A6B"></div><span style="position:absolute;right:10pt;top:8pt;font-size:8.5pt;font-weight:400">بدل السكن</span></div><div style="position:absolute;left:42pt;top:428pt;width:511pt;height:28pt;background:#fff;border:.6pt solid #8E7A6B;border-top:0;box-sizing:border-box"><div style="position:absolute;left:182pt;top:0;bottom:0;border-left:.6pt solid #8E7A6B"></div><span style="position:absolute;right:10pt;top:8pt;font-size:8.5pt;font-weight:400">بدل المواصلات</span></div><div style="position:absolute;left:42pt;top:456pt;width:511pt;height:28pt;background:#F6F1EB;border:.6pt solid #8E7A6B;border-top:0;box-sizing:border-box"><div style="position:absolute;left:182pt;top:0;bottom:0;border-left:.6pt solid #8E7A6B"></div><span style="position:absolute;right:10pt;top:8pt;font-size:8.5pt;font-weight:400">بدلات أخرى</span></div><div style="position:absolute;left:42pt;top:484pt;width:511pt;height:28pt;background:#fff;border:.6pt solid #8E7A6B;border-top:0;box-sizing:border-box"><div style="position:absolute;left:182pt;top:0;bottom:0;border-left:.6pt solid #8E7A6B"></div><span style="position:absolute;right:10pt;top:8pt;font-size:8.5pt;font-weight:600">إجمالي الراتب الشهري</span></div><div style="position:absolute;left:39pt;top:521pt;width:517pt;font-size:8pt;font-weight:600;text-align:right">إجمالي الراتب الشهري كتابةً (بالدرهم الإماراتي)</div><div style="position:absolute;left:39pt;top:534pt;width:517.3pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:39pt;top:563pt;width:517pt;font-size:8pt;font-weight:600;text-align:right">الغرض من الشهادة</div><div style="position:absolute;left:39pt;top:576pt;width:517.3pt;height:18pt;border:.8pt solid #8E7A6B;box-sizing:border-box"></div><div style="position:absolute;left:42pt;top:606pt;width:511pt;font-size:9pt;text-align:right">أُعطيت هذه الشهادة بناءً على طلب الموظف للغرض المذكور أعلاه، دون أدنى مسؤولية على الشركة.</div><div style="position:absolute;left:42pt;top:636pt;width:511pt;font-size:10pt;font-weight:600;text-align:right">عن {{company_ar}}</div><div style="position:absolute;left:42pt;top:676pt;width:330pt;right:42pt;text-align:right"><div style="font-size:10pt;font-weight:600">{{signatory_ar}}</div><div style="font-size:9pt;margin-top:2pt">{{signatory_title_ar}}</div></div><img src="images/templates/logo-llc.png" alt="" style="position:absolute;left:42pt;top:660pt;width:118pt"><div style="position:absolute;left:42pt;top:790pt;width:511pt;border-top:.6pt solid #8E7A6B"></div><div style="position:absolute;left:42pt;top:796pt;width:511pt;text-align:center;font-size:7.5pt;color:#8E7A6B">{{company_ar}} | {{address_ar}} | <span dir="ltr">{{phone}}</span></div></div>$tpl$, $tpl${"certificate_date": {"x": 306.6, "y": 158, "w": 246.6, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "recipient_name": {"x": 42, "y": 158, "w": 246.6, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "recipient_entity": {"x": 306.6, "y": 198, "w": 246.6, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "employee_name": {"x": 42, "y": 198, "w": 246.6, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "nationality": {"x": 306.6, "y": 238, "w": 246.6, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "passport_id": {"x": 42, "y": 238, "w": 246.6, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "job_title": {"x": 306.6, "y": 278, "w": 246.6, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "employment_start_date": {"x": 42, "y": 278, "w": 246.6, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "basic_salary": {"x": 46, "y": 376, "w": 174, "h": 20, "size": 9.5, "dir": "rtl", "align": "left"}, "housing_allowance": {"x": 46, "y": 404, "w": 174, "h": 20, "size": 9.5, "dir": "rtl", "align": "left"}, "transport_allowance": {"x": 46, "y": 432, "w": 174, "h": 20, "size": 9.5, "dir": "rtl", "align": "left"}, "other_allowance": {"x": 46, "y": 460, "w": 174, "h": 20, "size": 9.5, "dir": "rtl", "align": "left"}, "total_salary": {"x": 46, "y": 488, "w": 174, "h": 20, "bold": true, "size": 9.5, "dir": "rtl", "align": "left"}, "salary_in_words": {"x": 42, "y": 535, "w": 511.3, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "certificate_purpose": {"x": 42, "y": 577, "w": 511.3, "h": 16, "size": 9.5, "dir": "rtl", "align": "right"}, "cert_no": {"x": 373, "y": 110, "w": 180, "h": 12, "size": 7.5, "color": "#8E7A6B", "dir": "rtl", "align": "right"}}$tpl$::jsonb, true, true)
  on conflict (id) do update set page = excluded.page, bg_url = excluded.bg_url, bg_html = excluded.bg_html, fields = excluded.fields, name = excluded.name;
