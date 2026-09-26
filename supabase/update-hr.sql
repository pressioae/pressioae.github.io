-- Run once in Supabase → SQL Editor: people & payroll (safe to run again)
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
