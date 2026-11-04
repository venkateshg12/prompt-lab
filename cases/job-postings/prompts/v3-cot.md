---
key: v3-cot
technique: cot
notes: v1's text plus step-by-step reasoning, with the final JSON between <json> and </json>. The extractor takes the LAST block.
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

Think through the posting step by step: title, company, location, work mode, employment type,
minimum experience, skills (only real technical skills), and pay (convert "3-5 LPA" to numbers;
"competitive" means null). Then write the final answer as a JSON object between <json> and </json>.
