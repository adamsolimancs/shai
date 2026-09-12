create extension if not exists pg_trgm with schema extensions;

create index if not exists players_full_name_trgm_idx
  on public.players using gin (full_name extensions.gin_trgm_ops);

create index if not exists teams_full_name_trgm_idx
  on public.teams using gin (
    (coalesce(city, '') || ' ' || coalesce(name, '')) extensions.gin_trgm_ops
  );

create or replace function public.search_suggestions(
  p_query text,
  p_limit integer default 8
)
returns table (
  entity_type text,
  entity_id bigint,
  display_name text,
  secondary_text text,
  relevance double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with normalized as (
    select
      trim(p_query) as query_text,
      '%' ||
        replace(
          replace(
            replace(trim(p_query), chr(92), chr(92) || chr(92)),
            '%',
            chr(92) || '%'
          ),
          '_',
          chr(92) || '_'
        ) || '%' as query_pattern,
      least(greatest(coalesce(p_limit, 8), 1), 20) as result_limit
  ),
  candidates as (
    select
      'player'::text as entity_type,
      p.player_id::bigint as entity_id,
      p.full_name::text as display_name,
      t.abbreviation::text as secondary_text,
      (
        similarity(lower(p.full_name), lower(n.query_text))
        + case when lower(p.full_name) = lower(n.query_text) then 3.0 else 0.0 end
        + case when lower(p.full_name) like lower(n.query_text) || '%' then 1.5 else 0.0 end
        + case when lower(p.full_name) like '% ' || lower(n.query_text) || '%' then 0.75 else 0.0 end
        + case when lower(coalesce(p.is_active, '')) = 'true' then 0.05 else 0.0 end
      )::double precision as relevance
    from public.players p
    cross join normalized n
    left join public.teams t on t.team_id = p.current_team_id
    where length(n.query_text) >= 2
      and p.full_name ilike n.query_pattern escape '\'

    union all

    select
      'team'::text as entity_type,
      t.team_id::bigint as entity_id,
      trim(coalesce(t.city, '') || ' ' || coalesce(t.name, ''))::text as display_name,
      t.abbreviation::text as secondary_text,
      (
        similarity(
          lower(coalesce(t.city, '') || ' ' || coalesce(t.name, '')),
          lower(n.query_text)
        )
        + case
            when lower(coalesce(t.city, '') || ' ' || coalesce(t.name, '')) = lower(n.query_text)
              then 3.0
            else 0.0
          end
        + case
            when lower(coalesce(t.city, '') || ' ' || coalesce(t.name, ''))
              like lower(n.query_text) || '%'
              then 1.5
            else 0.0
          end
        + case when lower(coalesce(t.abbreviation, '')) = lower(n.query_text) then 2.0 else 0.0 end
      )::double precision as relevance
    from public.teams t
    cross join normalized n
    where length(n.query_text) >= 2
      and (
        (coalesce(t.city, '') || ' ' || coalesce(t.name, ''))
          ilike n.query_pattern escape '\'
        or coalesce(t.abbreviation, '') ilike n.query_pattern escape '\'
      )
  )
  select entity_type, entity_id, display_name, secondary_text, relevance
  from candidates
  where display_name <> ''
  order by relevance desc, display_name asc
  limit (select result_limit from normalized);
$$;

revoke all on function public.search_suggestions(text, integer) from public;
grant execute on function public.search_suggestions(text, integer) to service_role;
