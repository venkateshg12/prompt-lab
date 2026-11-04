import re, sys, glob, os
root = sys.argv[1]
TAG = re.compile(r'\s(COPY|ADAPT(?:→COPY)?|NEW)\b(.*)$')
rows = []
for f in sorted(glob.glob(os.path.join(root, 'docs/phases/phase-*.md'))):
    phase = os.path.basename(f)[6:8]
    text = open(f).read()
    m = re.search(r'^## 4\. Files\n(.*?)^## 5\.', text, re.S | re.M)
    if not m: continue
    for block in re.findall(r'```[a-z]*\n(.*?)```', m.group(1), re.S):
        stack = []  # (depth, dirpath)
        base = ''
        for line in block.splitlines():
            if not line.strip(): continue
            g = re.match(r'^((?:│   |    |│  |   )*)(├── |└── )?(.*)$', line)
            prefix, glyph, rest = g.group(1), g.group(2), g.group(3)
            tm = TAG.search(rest)
            name = (rest[:tm.start()] if tm else rest).strip()
            name = name.split('  ')[0].strip()
            if not glyph:
                depth = -1
                if name.endswith('/') and not tm:
                    base = name; stack = []; continue
                full = name
            else:
                depth = len(prefix) // 4
                stack = [s for s in stack if s[0] < depth]
                parent = stack[-1][1] if stack else base
                full = parent + name
                if name.endswith('/'):
                    stack.append((depth, full))
            if tm and name:
                tag = tm.group(1).replace('→COPY', '')
                src = re.search(r'(@[a-z]+-[a-z]+/\S*)', tm.group(2))
                note = tm.group(2).strip()
                rows.append((re.sub(r'^prompt-lab/','',full.rstrip()), tag, src.group(1).rstrip(',;)') if src else '—', phase, note))
def area(p):
    for a in ('apps/api/prisma','apps/api/src','apps/api/test','apps/api','apps/web','packages','cases','.github'):
        if p.startswith(a): return a
    return 'root and other'
order = ['root and other','packages','cases','apps/api','apps/api/prisma','apps/api/src','apps/api/test','apps/web','.github']
out = []
for a in order:
    rs = [r for r in rows if area(r[0]) == a]
    if not rs: continue
    out.append(f'\n## {a}\n\n| Path | Tag | Source | Phase |\n| --- | --- | --- | --- |')
    for p, t, s, ph, _ in rs:
        out.append(f'| `{p}` | {t} | {"`"+s+"`" if s!="—" else "—"} | {ph} |')
print('\n'.join(out))
print(f'\n<!-- {len(rows)} rows -->', file=sys.stderr)
