---
key: v2-few-shot
technique: few_shot
# Phase 25 picks the three DEV examples (one tagged salary_lpa), fills this list with their refs, and moves
# this file up to prompts/. It lives in drafts/ until then because the importer refuses a few_shot prompt
# whose examples don't exist yet.
fewShot: []
notes: v1's text plus {{examples}} at the end of the system prompt.
---
## system
{{instructions}}

Fields:
{{fields}}

Return only a JSON object with exactly these keys. No prose, no code fences.

{{examples}}

## user
Job posting:
"""
{{input}}
"""
