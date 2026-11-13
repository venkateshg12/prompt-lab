---
key: v2b-one-shot
technique: few_shot
# Playbook Lesson 2: v2 with ONLY the LPA example. Phase 25 fills in the one DEV ref tagged salary_lpa
# (the same one v2 uses) and moves this file up to prompts/. The importer refuses a few_shot prompt
# whose example doesn't exist yet, so it waits in drafts/.
fewShot: []
notes: v2 with only the salary_lpa example.
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
