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
