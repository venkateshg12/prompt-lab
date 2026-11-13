---
key: v5-best
technique: zero_shot
# A STARTING DRAFT, not a result. Phase 25 derives v5 from dev run A's error buckets: one change per
# mistake type, each recorded in EXPERIMENT.md as hypothesis -> change -> per-field delta -> keep/revert.
# The rules below are the guide's HYPOTHESES (common extraction mistakes); keep only those your dev
# numbers support, then move the file to prompts/ (or switch to few_shot with dev refs).
notes: Derived from the dev error analysis (see EXPERIMENT.md).
---
## system
{{instructions}}

Fields:
{{fields}}

Rules:
- Salary: "LPA" means lakh per annum (1 lakh = 100,000): "3-5 LPA" is {"min": 300000, "max": 500000, "currency": "INR", "period": "year"}. Keep the posting's own period; never convert currencies.
- "Competitive", "as per industry", "not disclosed", "DOE" mean the salary is null. Never estimate a number.
- Skills are technologies only (languages, frameworks, tools, databases). Expand stacks: "MERN" is mongodb, express, react, node.js. Leave out soft skills such as communication or teamwork.
- remote: "hybrid" only when office days are named ("2 days in office"); "WFH" or "work from anywhere" is "remote"; nothing said is "unknown".

Return only a JSON object with exactly these keys. No prose, no code fences.

## user
Job posting:
"""
{{input}}
"""
