# Case studies (versioned in git)

Each folder is one task, reproducible from a fresh clone:
- `task.json`: instructions + field rules (Phase 11)
- `data/*.jsonl`: labelled examples, one `{ id, split, tags, input, expected }` per line (Phase 12, 24)
- `prompts/*.md`: prompt versions (Phase 13, 25)
- `LABELLING.md`: how the labels were decided (Phase 24)

`pnpm --filter api import-cases` loads a folder into PostgreSQL (Phase 12).
