# Interview answers

One answer per question, five sentences at most, each quoting **one number from the README table** (or a
linked mistake from the published run). 👤 The `{…}` slots are filled from the final test run once it
exists; never from memory.

**How do you know a prompt is better?**
I develop on 30 dev examples and report the 70-example test split, run once, with 3 repeats. Every rate
has its `n` and a 95 % interval, and the table dims "best" when intervals overlap. {v5 vs v1 overall,
with both intervals}. A rerun of the test split is flagged `testReused` in the caption.

**When does few-shot help, and when not?**
{v1 vs v2 overall, and the salary column}. On the `salary_lpa` subset the difference is {subset number,
from `?tag=salary_lpa`}. It costs {v2 $/100 vs v1 $/100} because the examples are in every prompt.

**Did chain-of-thought help here?**
{v1 vs v3 overall} for {v3 output tokens / cost vs v1}. If it didn't help, that's the answer: extraction
has little to reason about, unlike `reasoning-mini`.

**Why use structured output mode?**
{v4 valid-JSON vs v1 valid-JSON}. It fixes the shape, not the content: {v4 salary vs v1 salary}. Models
the probe found unsupported show "n/a".

**How do you score a list field like skills?**
F1 over normalised sets with a synonym table, with precision and recall stored per result.
{v5 skills F1 (P / R)}.

**What does temperature do?**
Everything runs at 0, and it's still not deterministic on hosted inference: {consistency column for one
model}.

**What's a token, and a context window?**
{v2 vs v1 input tokens → $/100}: the few-shot examples are tokens sent with every posting.

**How do you stop a model inventing a salary?**
"Competitive" is labelled `null` and a number there scores 0 (`null_expected`). {salary_hidden subset
score for v1 vs v5}.

**Which model would you choose, and why?**
The cost-vs-accuracy chart's Pareto front: {the row I'd ship, its overall, valid JSON, $/100, p95}.

**How does a run survive a worker crash?**
One job per cell with a deterministic id, and a unique index on the result row, so a cell enqueued or
processed twice is stored and counted once; a sweeper re-adds missing cells. Both are integration-tested
on a real Postgres 17.

**How do you keep a visitor's key safe?**
It's used synchronously for that request, deleted from the request headers before anything can log it,
and never queued, stored or cached. The leak-scan test searches every table, both Redis instances and the
logs for it after a demo run.

**Why PostgreSQL rather than SQLite?** See [ADR 0001](adr/0001-postgresql-not-sqlite-or-mongodb.md).

**How do other projects consume your results?** A file contract owned by the reader, a copy tested on
every export, a drift test, and the Playbook's own importer run on real exports
([ADR 0006](adr/0006-playbook-export-contract.md)).
