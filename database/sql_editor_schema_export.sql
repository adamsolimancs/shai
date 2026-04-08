with table_columns as (
  select
    n.nspname as schema_name,
    c.relname as table_name,
    format(
      'create table %I.%I (\n%s\n);',
      n.nspname,
      c.relname,
      string_agg(
        format(
          '  %I %s%s%s%s',
          a.attname,
          pg_catalog.format_type(a.atttypid, a.atttypmod),
          case
            when a.attidentity in ('a', 'd') then
              ' generated ' ||
              case a.attidentity when 'a' then 'always' else 'by default' end ||
              ' as identity'
            else ''
          end,
          case
            when ad.adbin is not null and a.attidentity = '' then
              ' default ' || pg_get_expr(ad.adbin, ad.adrelid)
            else ''
          end,
          case when a.attnotnull then ' not null' else '' end
        ),
        E',\n' order by a.attnum
      )
    ) as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  left join pg_attrdef ad
    on ad.adrelid = a.attrelid
   and ad.adnum = a.attnum
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and a.attnum > 0
    and not a.attisdropped
  group by n.nspname, c.relname
),
constraints as (
  select
    format(
      'alter table %I.%I add constraint %I %s;',
      n.nspname,
      c.relname,
      con.conname,
      pg_get_constraintdef(con.oid)
    ) as ddl
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
),
indexes as (
  select
    indexdef || ';' as ddl
  from pg_indexes
  where schemaname = 'public'
    and indexname not in (
      select conname
      from pg_constraint
      where connamespace = 'public'::regnamespace
    )
)
select ddl
from (
  select ddl, 1 as section_order from table_columns
  union all
  select ddl, 2 as section_order from constraints
  union all
  select ddl, 3 as section_order from indexes
) statements
order by section_order, ddl;
