-- Pressio: place info from Google Maps (safe: saves a backup version first, touches only these fields)
select private.take_snapshot('Before Google Maps info update', 'manual', null);

update public.settings set data = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(data, '{home,info,area}', '{"ar": "الورقاء، دبي", "en": "Al Warqa, Dubai"}'::jsonb), '{home,info,addr}', '{"ar": "محل ٤١٤، Q1 مول، الورقاء، دبي", "en": "Shop 414, Q1 Mall, Al Warqa, Dubai"}'::jsonb), '{home,info,map}', '"https://maps.app.goo.gl/vrmAgtgstvNorV476"'::jsonb), '{home,info,phone}', '"050 394 2292"'::jsonb), '{home,info,week}', '[{"from": "08:00", "to": "01:00", "closed": false}, {"from": "06:00", "to": "00:30", "closed": false}, {"from": "06:30", "to": "00:30", "closed": false}, {"from": "06:30", "to": "00:30", "closed": false}, {"from": "06:30", "to": "00:30", "closed": false}, {"from": "06:30", "to": "01:00", "closed": false}, {"from": "08:00", "to": "01:00", "closed": false}]'::jsonb), '{home,info,hours}', '{"ar": "الإثنين ٦ص–١٢:٣٠ص · الثلاثاء–الخميس ٦:٣٠ص–١٢:٣٠ص · الجمعة ٦:٣٠ص–١ص · السبت والأحد ٨ص–١ص", "en": "Mon 6 AM–12:30 AM · Tue–Thu 6:30 AM–12:30 AM · Fri 6:30 AM–1 AM · Sat–Sun 8 AM–1 AM"}'::jsonb), '{home,info,rating}', '{"value": 5.0, "count": 23, "url": "https://maps.app.goo.gl/vrmAgtgstvNorV476"}'::jsonb), '{home,info,features}', '[{"ar": "جلسات داخلية", "en": "Dine-in"}, {"ar": "جلسات خارجية", "en": "Outdoor seating"}, {"ar": "درايف ثرو", "en": "Drive-through"}, {"ar": "سفري", "en": "Takeaway"}, {"ar": "توصيل", "en": "Delivery"}, {"ar": "فطور", "en": "Breakfast"}, {"ar": "حلويات", "en": "Desserts"}, {"ar": "مناسب للعائلات", "en": "Family friendly"}, {"ar": "مواقف مجانية", "en": "Free parking"}, {"ar": "دفع بالبطاقة والجوال", "en": "Card & mobile pay"}]'::jsonb) where id = 1;

-- old area name in the hero line and about text
update public.settings
   set data = replace(replace(data::text, 'الراشدية', 'الورقاء'), 'Rashidiya', 'Al Warqa')::jsonb
 where id = 1 and (data::text like '%الراشدية%' or data::text like '%Rashidiya%');

-- delivery links (only fills empty ones)
update public.settings set data = jsonb_set(data, '{home,delivery}', (
  select jsonb_agg(case
    when e->>'en' ilike 'talabat' and coalesce(e->>'url','') = '' then e || jsonb_build_object('url', 'https://www.talabat.com/uae/restaurant/1114847/pressio-cafe-al-warqa-1')
    when e->>'en' ilike 'keeta'   and coalesce(e->>'url','') = '' then e || jsonb_build_object('url', 'https://fooddelivery-eu.mykeeta.com/mpweb/shop_golden?useShopPoi=1&shopId=1644333666&cityId=118200003')
    else e end order by o)
  from jsonb_array_elements(data->'home'->'delivery') with ordinality x(e, o)))
 where id = 1;

select data->'home'->'info'->>'phone' as phone, data->'home'->'info'->'addr'->>'ar' as addr,
       jsonb_array_length(data->'home'->'info'->'week') as days,
       (select string_agg(coalesce(e->>'url',''), ' | ') from jsonb_array_elements(data->'home'->'delivery') e) as delivery,
       data->'home'->'hero'->>'sub_ar' as hero
  from public.settings where id = 1;
