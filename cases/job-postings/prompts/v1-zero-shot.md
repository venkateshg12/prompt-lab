---
key: v1-zero-shot
technique: zero_shot
notes: Baseline. Instructions + field list + "JSON only".
---
## system
{{instructions}}

Fields:
{{fields}}

Return only a JSON object with exactly these keys. No prose, no code fences.

## user
Job posting:
"""
{{input}}
"""
