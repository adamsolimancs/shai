# ShAI data inventory

Read-only inventory of the database configured in `backend/.env`, taken November
15, 2026 Eastern. This covers all 17 public application tables. Game and box
score observations in this database last advanced on October 26. The local
hoopR preview reads a validated snapshot file and leaves this database intact.

| Table | Rows | Source and next step |
| --- | ---: | --- |
| `teams` | 30 | Keep the existing NBA-ID directory. Add defunct franchises only when needed by historical foreign keys. Use [NBA franchise history](https://www.nba.com/stats/history) and [the archive's franchise files](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores) to check IDs and relocations. |
| `players` | 5,184 | Keep NBA IDs as canonical. Compare the [NBA player directory](https://www.nba.com/players) and the archive's `Players.csv` for missing identities. Resolve discrepancies before inserting. |
| `player_info` | 0 | Start with `Players.csv` for birth date, draft, height, and other biographical fields. Use [SportsDataverse NBA-ID rosters](https://github.com/sportsdataverse/hoopR-nba-stats-data) for recent team and roster fields. Preserve nulls for unavailable fields and keep current rosters separate from historical team affiliations. |
| `player_season_stats` | 400 | The tested [NBA-ID season archive](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_season_stats) covers 1996–97 through 2026–27. Earlier seasons need validated season totals with an identity crosswalk. See the historical audit below. |
| `games` | 52 | Use [NBA-ID SportsDataverse schedules](https://github.com/sportsdataverse/hoopR-nba-stats-data) or validated [Kaggle `Games.csv`](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores) for historical results. Restore official game ID zero padding. Map ESPN-to-NBA IDs before adding hoopR ESPN rows to this table. |
| `boxscores` | 15 | Use [SportsDataverse NBA-ID team box scores](https://github.com/sportsdataverse/hoopR-nba-stats-data) for the canonical table. For the morning ESPN feed, use the team box file and schedule after a game and team crosswalk is qualified. Publish each game together with its player lines. |
| `boxscore_players` | 523 | Use [SportsDataverse NBA-ID player box scores](https://github.com/sportsdataverse/hoopR-nba-stats-data) or reconciled Kaggle player lines. The morning [ESPN export](https://github.com/sportsdataverse/hoopR-nba-data) already serves the dev snapshot. Canonical import also needs an ESPN-to-NBA player crosswalk. |
| `league_standings` | 30 | Use [SportsDataverse NBA-ID standings](https://github.com/sportsdataverse/hoopR-nba-stats-data). Historical reconstruction from game results needs full schedule coverage and season-specific ranking rules. |
| `team_season_history` | 0 | Use [SportsDataverse team season stats](https://github.com/sportsdataverse/hoopR-nba-stats-data) for supported seasons. Cross-check older wins, losses, and franchise labels with [NBA season recaps](https://www.nba.com/news/history-season-recaps-index) and official season summaries. |
| `team_advanced_stats` | 0 | Use [SportsDataverse NBA-ID team season stats](https://github.com/sportsdataverse/hoopR-nba-stats-data) with the advanced measure type. The NBA documents advanced coverage beginning in 1996–97. Earlier values require a separately labeled estimation method. [NBA Stats FAQ](https://www.nba.com/stats/help/faq) |
| `team_details` | 0 | Seed a small directory from [official team sites](https://www.nba.com/teams), franchise histories, and media guides. Validate each arena, historical title, and retired number against its club source. |
| `player_awards` | 0 | Start with [NBA award results and All-NBA selections](https://www.nba.com/news/history-all-time-awards). Map winners to NBA player IDs and distinguish award winners from voting shares. |
| `league_leader_rows` | 0 | Derive leaderboards from a fully validated season import if ShAI can disclose its metric and qualification rules. Leave the official rankings feature empty where the [NBA leader data](https://www.nba.com/stats/leaders) is unavailable. |
| `news_articles` | 0 | The existing news service references ESPN and CBS feeds. Use publisher feeds or another source that authorizes the intended use, keep links to the original pages, and store only the metadata the source permits. [Current service](../backend/app/services/news.py) |
| `api_snapshots` | 7 | Populate from successful imports. The hoopR workflow writes its validated slate snapshot here when configured. Other entries are produced by the services that consume them. |
| `ingestion_state` | 39 | The ingestion worker writes attempts, failures, and successful checkpoints. Let runs generate these records. |
| `user_accounts` | 0 | ShAI creates these from its own sign-in flow. This table needs normal account creation. |

## Kaggle game archive audit

The [Kaggle API metadata for Eoin Moore's dataset](https://www.kaggle.com/api/v1/datasets/view/eoinamoore/historical-nba-data-and-player-box-scores)
declares CC0 and reported version 548. Its publisher says the pipeline collects
from NBA.com. The license declaration establishes what the uploader claims
for the dataset. It leaves upstream publication rights unresolved. [Pipeline
source](https://github.com/eoinmooremath/nba-data-pipeline)

The regular-season and playoff files contained 33,378 listed games and 661,848
distinct player-game rows from 1946–47 through 1995–96. Of 2,446 player IDs,
2,440 matched the local NBA static directory by ID. The six remaining IDs need
individual review. There were 712 games with a score reconciliation or team
coverage exception in the initial check, which used the supplied team IDs.

The file contains only 18 regular-season games for 1946–47. Joe Fulks has 12
regular-season rows totaling 247 points. The NBA lists 60 games and the
Warriors' official media guide lists 1,389 points. The same file matches the
NBA's published games and points for Wilt Chamberlain's 1961–62 and Michael
Jordan's 1986–87 regular seasons. Individual matches cannot establish full
season coverage. The earliest player rows also use zeros for some stats the
NBA marks unavailable. [Fulks NBA player page](https://www.nba.com/player/76764/joe-fulks)
· [Warriors media guide](https://ak-static-int.nba.com/wp-content/uploads/sites/3/2016/10/2016-17-Media-Guide-Warriors.pdf)
· [NBA historical scoring comparison](https://api-hub.nba.com/news/embiid-70-highest-per-minute-scoring-average)

Use direct season totals for the oldest player seasons. Before import, map
identities and franchises, preserve missing stats as null, use the combined
season total for traded players, and validate season coverage and benchmark
players. Use this game archive only where its coverage and box scores pass
those checks.

## Better candidate for early regular-season totals

[Sumitro Datta's NBA Stats archive](https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats)
includes `Player Totals.csv` and `Player Career Info.csv`. Its [Kaggle API
metadata](https://www.kaggle.com/api/v1/datasets/view/sumitrodatta/nba-aba-baa-stats)
declares CC0 and reported version 57. It uses Basketball Reference player IDs.
[Sports Reference data use policy](https://www.sports-reference.com/data_use.html)

For NBA and BAA regular seasons, the downloaded files cover all 50 requested
years. They contain 11,184 player-season groups after combining team stints.
All 1,093 multi-team groups have exactly one combined totals row. The archive
matches the official scoring and games-played benchmarks for Fulks, Chamberlain,
and Jordan above, and preserves unavailable fields for Fulks as `NA`.

A unique normalized name and exact birth date joined 10,302 player-season
groups to an NBA ID in Moore's `Players.csv`. The remaining 882 groups cover 286
identities and need a verified crosswalk before import. This test establishes
a path for regular-season totals. Historical playoff totals still need a
qualified source. No historical data was written to the configured database.
