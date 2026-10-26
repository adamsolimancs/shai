# API-NBA qualification

Tested from a GitHub-hosted Ubuntu runner on 2026-10-26:
[Actions run 40371805559](https://github.com/adamsolimancs/shai/actions/runs/40371805559),
probe commit `96417a059ea00d662fa18d1f93b45ddb888b4eb0`.

| Request | Result |
| --- | --- |
| `/status` | HTTP 200; active free subscription verified |
| `/seasons` | HTTP 200; season `2026` present among 12 seasons |
| `/leagues` | HTTP 200; `standard` present among 6 leagues |
| `/games?league=standard&season=2026` | HTTP 200 with provider error, classified as a subscription/plan restriction |

The provider is reachable from Actions and the key authenticates. Discovery of
season `2026` does **not** establish that this free subscription can retrieve
2026–27 games. The probe failed at that request and stopped after four requests;
standings, rosters, season totals, and game/player box scores were not tested.
Continuous live updates were not verified. Raw account information and arbitrary
provider error text are deliberately excluded from logs.

There were no database/cache writes or purchases. The production ingestion job
was skipped. The workflow was restored to `disabled_manually` immediately after
dispatch; the Mac ingestion service was unchanged.

The provider's [beginner guide](https://www.api-football.com/news/post/how-to-get-started-with-api-nba-the-complete-beginners-guide)
advertises a free allowance and a $15/month PRO tier. The observed free-plan
restriction means the guide alone is insufficient evidence of current-season
access. Confirm 2026–27 entitlement with the provider before paying. A paid plan
has not been tested, and switching production would still require provider-ID
mapping and an ingestion adapter.

Local validation: 104 worker tests passed, including 19 provider-probe tests;
workflow YAML and probe credential isolation checks passed.

To repeat after an entitlement change, manually dispatch `ingest.yml` from the
branch containing the probe with `api_nba_probe=true`. The probe requires a free
subscription, caps itself at ten paced requests, and fails on missing coverage.
Testing a paid subscription requires an explicit probe policy change first.
