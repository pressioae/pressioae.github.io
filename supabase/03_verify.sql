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
