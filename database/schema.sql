| ddl                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATE TABLE public.boxscore_players (\n  game_id text NOT NULL,
  player_id text NOT NULL,
  player_name text,
  team_id bigint,
  team_abbreviation text,
  minutes text,
  stat_type text,
  start_position text,
  field_goals_made smallint,
  field_goals_attempted smallint,
  field_goal_pct real,
  three_point_made smallint,
  three_point_attempted smallint,
  three_point_pct real,
  free_throws_made smallint,
  free_throws_attempted smallint,
  free_throw_pct real,
  offensive_rebounds smallint,
  defensive_rebounds smallint,
  rebounds smallint,
  assists smallint,
  steals smallint,
  blocks smallint,
  turnovers smallint,
  fouls smallint,
  points smallint,
  plus_minus smallint,
  offensive_rating real,
  defensive_rating real,
  net_rating real,
  usage_pct text,
  true_shooting_pct real,
  effective_fg_pct real,
  assist_pct real,
  assist_to_turnover real,
  rebound_pct real,
  offensive_rebound_pct real,
  defensive_rebound_pct real,
  pace real,
  pace_per40 real,
  possessions real,
  pie real\n);\n |
| CREATE TABLE public.boxscores (\n  game_id text NOT NULL,
  status text NOT NULL,
  game_date text,
  start_time text,
  arena text,
  attendance text,
  officials text,
  home_team text,
  away_team text,
  line_score text,
  team_totals text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CREATE TABLE public.games (\n  game_id text NOT NULL,
  date text,
  start_time text,
  home_team_id bigint,
  home_team_name text,
  home_team_score smallint,
  away_team_id bigint,
  away_team_name text,
  away_team_score smallint,
  season integer\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CREATE TABLE public.api_snapshots (\n  cache_key text NOT NULL,
  payload text,
  updated_at text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CREATE TABLE public.ingestion_state (\n  id text,
  source text NOT NULL,
  entity text NOT NULL,
  status text,
  last_success_at text,
  last_attempt_at text,
  last_cursor text,
  last_error text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CREATE TABLE public.league_standings (\n  season text NOT NULL,
  team_id bigint NOT NULL,
  conference text,
  conference_rank smallint,
  division text,
  division_rank smallint,
  wins smallint,
  losses smallint,
  win_pct real,
  games_back real,
  division_games_back real,
  record text,
  home_record text,
  road_record text,
  last_ten text,
  streak text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CREATE TABLE public.news_articles (\n  id text NOT NULL,
  source text,
  title text,
  summary text,
  url text,
  published_at text,
  image_url text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CREATE TABLE public.player_awards (\n  player_id text NOT NULL,
  season text NOT NULL,
  description text NOT NULL,
  subtype1 text,
  month text,
  all_nba_team_number smallint\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CREATE TABLE public.player_season_stats (\n  season text NOT NULL,
  player_id text NOT NULL,
  team_id bigint,
  games_played smallint,
  games_started smallint,
  minutes_pg real,
  points_pg real,
  rebounds_pg real,
  assists_pg real,
  steals_pg real,
  blocks_pg real,
  field_goal_pct_pg real,
  three_point_pct_pg real,
  free_throw_pct_pg real,
  true_shooting_pct_pg real,
  season_type text NOT NULL DEFAULT 'Regular Season'::text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                       |
| CREATE TABLE public.player_info (\n  player_id text NOT NULL,
  first_name text,
  last_name text,
  display_name text,
  position text,
  jersey text,
  birthdate text,
  school text,
  country text,
  season_experience smallint,
  roster_status text,
  from_year smallint,
  to_year smallint,
  team_id bigint,
  team_name text,
  team_abbreviation text,
  updated_at text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CREATE TABLE public.players (\n  player_id text NOT NULL,
  full_name text,
  current_team_id bigint,
  is_active text,
  height text,
  weight smallint,
  draft_year smallint,
  draft_pick text,
  country text,
  college text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CREATE TABLE public.user_accounts (\n  auth_user_id uuid NOT NULL,
  name text,
  username text,
  email text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CREATE TABLE public.team_season_history (\n  season text NOT NULL,
  team_id bigint NOT NULL,
  season_type text NOT NULL DEFAULT 'Regular Season'::text,
  per_mode text NOT NULL DEFAULT 'Totals'::text,
  team_city text,
  team_name text,
  games_played smallint,
  wins smallint,
  losses smallint,
  win_pct real,
  conference_rank smallint,
  division_rank smallint,
  playoff_wins smallint,
  playoff_losses smallint,
  finals_result text,
  points real,
  field_goal_pct real,
  three_point_pct real,
  updated_at text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CREATE TABLE public.team_advanced_stats (\n  season text NOT NULL,
  team_id bigint NOT NULL,
  ppg double precision,
  ppg_allowed double precision,
  ortg real,
  ortg_rank smallint,
  drtg real,
  drtg_rank smallint,
  apg real,
  topg real,
  netrtg real\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CREATE TABLE public.team_details (\n  team_id bigint NOT NULL,
  year_founded text,
  arena text,
  arena_capacity integer,
  owner text,
  general_manager text,
  head_coach text,
  dleague_affiliation text,
  championships text,
  conference_titles text,
  division_titles text,
  hall_of_famers text,
  retired_numbers text,
  social_sites text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CREATE TABLE public.league_leader_rows (\n  season text NOT NULL,
  season_type text NOT NULL DEFAULT 'Regular Season'::text,
  per_mode text NOT NULL DEFAULT 'PerGame'::text,
  stat_category text NOT NULL,
  rank smallint NOT NULL,
  player_id text NOT NULL,
  player_name text,
  team_id bigint,
  team_abbreviation text,
  games_played smallint,
  minutes real,
  points real,
  rebounds real,
  assists real,
  steals real,
  blocks real,
  turnovers real,
  efficiency real,
  stat_value real,
  updated_at text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CREATE TABLE public.teams (\n  team_id bigint NOT NULL,
  abbreviation text,
  city text,
  name text,
  conference text,
  division text\n);\n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

| ddl                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALTER TABLE public.boxscore_players ADD CONSTRAINT boxscore_players_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(game_id) ON UPDATE CASCADE ON DELETE CASCADE;\n                 |
| ALTER TABLE public.boxscore_players ADD CONSTRAINT boxscore_players_pkey PRIMARY KEY (game_id, player_id);\n                                                                            |
| ALTER TABLE public.boxscore_players ADD CONSTRAINT boxscore_players_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(player_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n       |
| ALTER TABLE public.boxscore_players ADD CONSTRAINT boxscore_players_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(team_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n               |
| ALTER TABLE public.boxscores ADD CONSTRAINT boxscores_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(game_id) ON UPDATE CASCADE ON DELETE RESTRICT;\n                              |
| ALTER TABLE public.boxscores ADD CONSTRAINT boxscores_pkey PRIMARY KEY (game_id);\n                                                                                                     |
| ALTER TABLE public.games ADD CONSTRAINT games_pkey PRIMARY KEY (game_id);\n                                                                                                             |
| ALTER TABLE public.api_snapshots ADD CONSTRAINT api_snapshots_pkey PRIMARY KEY (cache_key);\n                                                                                           |
| ALTER TABLE public.ingestion_state ADD CONSTRAINT ingestion_state_pkey PRIMARY KEY (source, entity);\n                                                                                  |
| ALTER TABLE public.league_standings ADD CONSTRAINT league_standings_pkey PRIMARY KEY (season, team_id);\n                                                                               |
| ALTER TABLE public.league_standings ADD CONSTRAINT league_standings_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(team_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n               |
| ALTER TABLE public.news_articles ADD CONSTRAINT news_articles_pkey PRIMARY KEY (id);\n                                                                                                  |
| ALTER TABLE public.player_awards ADD CONSTRAINT player_awards_pkey PRIMARY KEY (player_id, season, description);\n                                                                      |
| ALTER TABLE public.player_awards ADD CONSTRAINT player_awards_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(player_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n             |
| ALTER TABLE public.player_info ADD CONSTRAINT player_info_pkey PRIMARY KEY (player_id);\n                                                                                                |
| ALTER TABLE public.player_info ADD CONSTRAINT player_info_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(player_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n                  |
| ALTER TABLE public.player_info ADD CONSTRAINT player_info_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(team_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n                            |
| ALTER TABLE public.player_season_stats ADD CONSTRAINT player_season_stats_pkey PRIMARY KEY (season, player_id, season_type);\n                                                          |
| ALTER TABLE public.player_season_stats ADD CONSTRAINT player_season_stats_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(player_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n |
| ALTER TABLE public.player_season_stats ADD CONSTRAINT player_season_stats_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(team_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n         |
| ALTER TABLE public.players ADD CONSTRAINT players_pkey PRIMARY KEY (player_id);\n                                                                                                       |
| ALTER TABLE public.user_accounts ADD CONSTRAINT user_accounts_pkey PRIMARY KEY (auth_user_id);\n                                                                                       |
| ALTER TABLE public.user_accounts ADD CONSTRAINT user_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;\n            |
| ALTER TABLE public.user_accounts ADD CONSTRAINT user_accounts_email_key UNIQUE (email);\n                                                                                              |
| ALTER TABLE public.user_accounts ADD CONSTRAINT user_accounts_username_key UNIQUE (username);\n                                                                                        |
| ALTER TABLE public.team_season_history ADD CONSTRAINT team_season_history_pkey PRIMARY KEY (season, team_id, season_type, per_mode);\n                                                   |
| ALTER TABLE public.team_season_history ADD CONSTRAINT team_season_history_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(team_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n            |
| ALTER TABLE public.team_advanced_stats ADD CONSTRAINT team_stats_pkey PRIMARY KEY (season, team_id);\n                                                                                  |
| ALTER TABLE public.team_advanced_stats ADD CONSTRAINT team_stats_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(team_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n                  |
| ALTER TABLE public.team_details ADD CONSTRAINT team_details_pkey PRIMARY KEY (team_id);\n                                                                                               |
| ALTER TABLE public.team_details ADD CONSTRAINT team_details_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(team_id) ON UPDATE CASCADE ON DELETE RESTRICT;\n                        |
| ALTER TABLE public.league_leader_rows ADD CONSTRAINT league_leader_rows_pkey PRIMARY KEY (season, season_type, per_mode, stat_category, rank, player_id);\n                             |
| ALTER TABLE public.league_leader_rows ADD CONSTRAINT league_leader_rows_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(player_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n    |
| ALTER TABLE public.league_leader_rows ADD CONSTRAINT league_leader_rows_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(team_id) ON UPDATE RESTRICT ON DELETE RESTRICT;\n            |
| ALTER TABLE public.teams ADD CONSTRAINT teams_pkey PRIMARY KEY (team_id);\n                                                                                                             |
