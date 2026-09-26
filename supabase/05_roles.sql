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
