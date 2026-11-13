# Sources and anonymisation

👤 To be completed by the owner while collecting the postings (Phase 24).

## Collection

- Where the postings came from (sites, date range), collected by hand from public postings within each
  site's terms. No scraping that violates them.
- How many were collected, and how the tag mix was aimed at (see the target table in
  `docs/phases/phase-24-dataset.md`).

## Anonymisation

- Real company names are replaced with fictional ones from the fixed list below. Every real name seen goes
  into `.private-names.txt` (gitignored), which `check-public.ts` reads.
- Emails, phone numbers, URLs and recruiter names are removed; boilerplate is trimmed. Salary text,
  work-mode wording and skills sentences are kept as written.
- Postings that can't be shared even anonymised are imported with `publicInput: false`.

Fictional company names (fixed list):

| # | Name |
| --- | --- |
| 1 | |

## How labels were produced

- Drafted by: (none / a model NOT in the comparison: name it), then every field checked by hand against
  `LABELLING.md`.
- Second labeller: 20 postings (8 dev, 12 test), blind; agreement in `data/AGREEMENT.md`.
