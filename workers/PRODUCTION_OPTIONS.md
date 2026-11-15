# Production ingestion options

Budget supplied by the user: up to USD 25/month, preferably free. This is a
research and migration plan, not a deployed provider integration. No account,
subscription, paid service or production ingestion setting was changed.

## Decision after the October 26 live evaluation

Keep the Mac and Actions writers paused pending a decision to resume ingestion.
The Mac remains the only tested host that completed a scheduled run with the
existing source. A restart requires a fresh source check from that host and
verification that the first scheduled runs advance observations and checkpoints.
[Mac runbook](SELF_HOSTED.md) · [Render investigation](HOSTED_BACKEND_QUALIFICATION.md)

API-NBA's free key worked from Actions with a date-only query. The sample found
all nine games and matched all six completed scores. It matched 6 of 24 live
score comparisons against ESPN, one observed game state lagged the comparison
feed by about 91 seconds, and one final box score omitted Christian Anderson's
three points. ESPN was a comparison feed. The tests establish neither a
provider-wide delay nor the paid plan's freshness or completeness.
[API-NBA live evaluation and evidence](API_NBA_LIVE_EVALUATION.md)

API-NBA remains a candidate for delayed scores. Before choosing it for live
scores and player stats, test several slates from the intended host, measure
how long endpoints take to agree after finalization, and check player and team
coverage. A provider adapter would need to hold back internally inconsistent
snapshots and preserve the last verified publication. The bootstrap now checks
per-team scoring in final snapshots. That check catches missing scoring points,
while roster completeness and other stats still need independent validation.

## October 26 pricing and hosting estimates

**API-NBA by API-SPORTS** is a hosted API at
`https://v2.nba.api-sports.io`, distinct from the Python `nba_api` client.
The documented PRO price is USD 15/month, with 7,500 requests/day and 300/minute.
The free plan allows 100/day and 10/minute, with endpoint access suitable for
an initial coverage test. [Provider pricing](https://api-sports.io/sports/nba),
[provider setup guide](https://www.api-football.com/news/post/how-to-get-started-with-api-nba-the-complete-beginners-guide).

For hosting, start with a **Render cron job** if the existing five-minute cadence
is sufficient. Its minimum is USD 1/month; actual runtime is metered. The current
512 MB / 0.5 CPU cron rate is USD 0.00016/minute. For example, 144 daily runs
lasting one minute each over 30 days total USD 0.6912 of compute, so the minimum
would apply; startup and actual duration must be measured. This makes roughly
USD 16/month a plausible baseline, not a fixed-price quote.
[Cron billing and single-run behavior](https://render.com/docs/cronjobs),
[live compute pricing](https://render.com/pricing#cron-jobs).

If sub-minute polling becomes necessary, Render's continuously running
512 MB / 0.5 CPU worker is USD 7/month on the USD 0 Hobby workspace plan. Combined
with the feed, that is **USD 22/month** before taxes, metered extras and existing
Neon/Redis charges. The current pricing table was checked in the rendered website,
because the plain HTML extraction omits the compute prices. Avoid choosing the
USD 25 Pro *workspace* plan: it is separate from worker compute and is unnecessary
for this one-person setup.
[Services and workers pricing](https://render.com/pricing#services),
[continuous workers](https://render.com/docs/background-workers).

This route avoids depending on NBA's willingness to serve the worker's cloud IP.
It does not establish a contractual data-availability SLA: API-SPORTS' terms provide
data as-is. Paid-plan data quality, latency and current 2026–27 coverage still need
to be tested with an authenticated account.
[Provider service/data terms](https://api-sports.io/terms).

## Lower-cost and higher-cost alternatives

| Option | Incremental monthly cost | Fit |
| --- | --- | --- |
| API-NBA free + standard Actions on this public repo | USD 0 | Suitable for validation or a deliberately reduced snapshot/final-score service, not the current frequent full live refresh. |
| API-NBA PRO + Actions | USD 15 | Cheapest candidate for roughly five-minute updates, accepting scheduler delays. |
| API-NBA PRO + Render cron | USD 15 + metered cron, minimum USD 1 | Recommended initial production candidate after validation. |
| API-NBA PRO + Render continuous worker | USD 22 before extras | Fits the cap and permits more controlled polling. |
| BALLDONTLIE GOAT | USD 39.99 before hosting | Good feature overlap, but outside the budget. Its free/ALL-STAR tiers omit direct box-score, season-average and standings endpoints needed for a straightforward replacement. |
| SportsDataIO live feed | Sales quote | Has an SLA-backed live product, but no documented self-serve live price fitting this cap. Its trial data is scrambled; Discovery Lab is next-day delayed. |

Sources: [GitHub standard-runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[BALLDONTLIE tiers](https://docs.balldontlie.io/#account-tiers),
[SportsDataIO product distinctions](https://sportsdata.io/developers).

GitHub explicitly permits scheduled-run delays and dropped queued runs, with a
five-minute minimum interval. It is usable for a cost-sensitive periodic sync,
but is not a precise live-data clock.
[GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Why the free API quota is too small for current behavior: one scoreboard call
every five minutes for the existing 12-hour active window is **144 calls/day**,
before any detailed statistics. Free use would require substantially fewer
refreshes or fewer features. There is no need to buy a plan merely to test whether
the required endpoints return usable current-season data.

Moving the existing `nba_api` worker to an untested VPS is not a reliable fix by
itself. Our network experiment showed the same NBA server IP serving the Mac
while withholding responses from Actions. Another cloud IP might work, but no
successful access test or continuing-access assurance exists for that host.
An always-on home computer would remove the Mac dependency but retain the power,
network and unofficial-source dependencies. See [measured evidence](../PIPELINE.md).

## Coverage and migration fit

API-NBA documents games/live state, team and player game statistics, standings,
team profiles and season team totals. It uses `season=2026` for 2026–27 and
`league=standard`. Player-stat queries are game/player/team-season oriented;
team-season figures are generally totals, so existing per-game serving rows may
need calculated averages. This is an adapter change, not an endpoint URL swap.
[Current-season guide](https://www.api-football.com/news/post/2026-2027-nba-season-guide-to-using-data-with-api-sports),
[endpoint semantics](https://www.api-football.com/news/post/how-to-get-started-with-api-nba-the-complete-beginners-guide).

Repository-specific requirements:

- Preserve the existing `Client -> API -> Redis -> Neon` read path. Only the
  ingestion source should depend on the provider; visitor traffic must not consume
  provider calls directly.
- Add explicit external-ID mapping for teams, players and games. The DB already
  contains NBA IDs, and the bootstrap validates `00226...` game IDs. Provider IDs
  must not be inserted as if they were those IDs, collide with retained identities,
  or silently produce duplicate games and incorrect player photos.
- Map provider responses into the existing normalized snapshots. Missing advanced
  fields remain absent; do not label derived rankings as official standings.
- Reuse the resumable stage/checkpoint publication, transactional game snapshots,
  shared Redis writer lease and post-publication cache invalidation.
- Cache references slowly; refresh games frequently only while active; persist
  completed games and fetch corrections later. Read quota headers and reserve
  headroom instead of using retry storms.
- Keep 2026–27-only scope. No previous-season or career backfill is required.

## Remaining validation before a source switch

1. Reconfirm the date-only schedule and game-ID payloads from the intended cloud
   runtime. Check the API's `errors` field as well as HTTP status. Use the bounded
   probe and avoid production DB and Redis credentials in provider diagnostics.
2. Sample multiple live games and completed box scores across different stages
   of play. Measure freshness, endpoint agreement, missing player lines,
   finalization and corrections. Verify season stats and standings for all
   30 teams and check player identity and roster coverage.
3. Rehearse the new adapter and ID mapping against an empty/disposable database,
   including duplicate/retry and partially unavailable responses. Then do a
   limited production run and verify freshness through the existing health report.
4. Confirm consecutive successful scheduled cloud runs with observations and
   consistent box scores. Keep production to one active scheduler and retain
   the shared lease. If the Mac was resumed in the meantime, pause it before
   enabling the cloud scheduler.
