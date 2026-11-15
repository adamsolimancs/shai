# API-NBA live evaluation — October 26, 2026

The free API-SPORTS key works from GitHub Actions for current live games,
date-only game queries, game IDs, team box scores and player game statistics.
The earlier rejected season-wide request did **not** establish a blanket
restriction on 2026–27 data. Combining `league` without a season was also rejected;
the documented date-only query worked. No subscription was purchased.

The observed feed is useful for delayed scores, but this sample does not justify
using it as the sole source for near-live scores or complete player statistics.
Paid-plan freshness and completeness were not tested.

## Method and evidence

- [First Actions run](https://github.com/adamsolimancs/shai/actions/runs/40439962241):
  four snapshots from **10:42:36–10:44:07 p.m. Eastern**.
- [Corrected date-query run](https://github.com/adamsolimancs/shai/actions/runs/40440521644):
  four snapshots from **10:48:15–10:49:46 p.m. Eastern**.
- Each live query was bracketed by ESPN scoreboard reads. Team abbreviations
  were normalized, games matched by home/away teams, and only standard-league
  2026-season games on October 26 in New York were included.
- Two UTC dates cover the New York slate. Nine matching games were found;
  unrelated returned games were filtered out.
- A separate temporary local ESPN sampler corroborated the cloud references.
- Machine-readable snapshots: [evidence](evidence/api-nba-live-2026-10-26.json).

## Findings

| Check | Observed result |
| --- | --- |
| Tonight's game coverage | 9/9 games found |
| Completed-game scores | All 6 matched ESPN |
| Live status | All 24 live game/status comparisons matched |
| Contemporaneous live scores | 6/24 matched across eight snapshots of three games |
| Successful provider payload response time | Median 134.5 ms; maximum 311 ms |
| Live updates | Observed in both sampling windows, with intermittent unchanged snapshots |

The score-match count measures synchronization with ESPN, **not a claim of
25% eventual scoring accuracy**. The mismatch pattern was consistent with delayed
updates. ESPN is itself a comparison feed, not broadcast ground truth.

For example, at **10:44:07 p.m. Eastern**, the away–home scores were:

| Matchup | API-NBA | ESPN |
| --- | --- | --- |
| Atlanta @ Houston | 95–112 | 95–115 |
| Memphis @ Utah | 72–65 | 74–66 |
| Golden State @ Denver | 34–32 | 36–34 |

Golden State–Denver's API-NBA score and Q2 **10:51** clock at that moment matched
the state ESPN had reported about **91 seconds earlier**. Earlier API snapshots
still showed Q1 after ESPN had entered Q2. This is evidence of an older observed
state; it is not a guaranteed end-to-end latency estimate. Game-clock differences
also cannot be interpreted directly as wall-clock delivery delay.

## Player and team consistency

The completed Wizards–Hornets game had the correct **103–110** final score and
matching team-stat points. However, its 20 returned player lines summed to:

| Team | Game/team-stat points | Sum of player points |
| --- | --- | --- |
| Washington | 103 | 103 |
| Charlotte | 110 | **107** |

ESPN's completed-game box score contains 21 player lines, and Charlotte's player
points sum to 110. Because the game was already final, this discrepancy cannot
be dismissed as points scored between two live requests.

The [player-level spot check](https://github.com/adamsolimancs/shai/actions/runs/40441725148)
at approximately **11:01 p.m. Eastern** confirmed the cause: **Christian Anderson's
3-point line was absent**. The other 20 returned players' points matched ESPN.
Four names required a unique within-team first-initial/surname match because
API-NBA returned `S. James`, `R. Kalkbrenner`, `W. Riley`, and `T. Johnson`.
No differing point values were found among the matched players. Rebounds,
assists, shooting splits and other individual fields were not independently
verified. One completed box score is a spot check, not a provider-wide error rate.

A live Hawks–Rockets check also showed player/team stats at Houston 112 while
the later game-ID response had Houston 115. Separately fetched live endpoints
can therefore reflect different update times. They must be reconciled before
publication as one coherent game snapshot.

## Practical assessment and limits

For this tested free subscription, current live access is available and final
team scores looked correct. Live freshness and player completeness need guards:
display source timestamps/delay clearly, validate player coverage and totals,
and avoid treating every HTTP 200 as complete, current data. A paid plan was not
tested, so paying should not be assumed to remove either observed issue.

The three completed runs made **27 provider HTTP requests** combined, including
status and rejected queries; this is not a claim that all 27 were billed against
quota. One earlier player-check attempt remains reported as queued with no jobs;
GitHub rejected cancellation as already completed. It contains only the bounded
read-only diagnostic if admitted, with no database/Redis credentials.
No database/Redis credentials were passed to the probe job. The Mac ingestion
service and recurring Actions ingestion remain paused. No production ingestion
data was published. Local validation: 128 worker tests passed; workflow YAML and
credential-isolation checks passed.
