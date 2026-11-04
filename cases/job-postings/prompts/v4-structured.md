---
key: v4-structured
technique: structured
notes: v1's text, sent with the provider's schema mode (nvext.guided_json / response_format / output_config). "Return only a JSON object" stays, because it helps models that half-honour the schema.
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
