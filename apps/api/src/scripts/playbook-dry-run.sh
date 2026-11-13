#!/usr/bin/env bash
# Runs the Playbook's REAL importer with --dry-run for every lesson block in cases/HANDOFF.md (```bash
# blocks only; ```text blocks need Playbook flags that don't exist yet). Nothing is written to the Playbook:
# --dry-run, and --root points at a fresh temp dir. Usage: bash apps/api/src/scripts/playbook-dry-run.sh
set -euo pipefail
PL="$(cd "$(dirname "$0")/../../../.." && pwd)"
PLAYBOOK_ROOT="${PLAYBOOK_ROOT:-$HOME/Code/prompt-engineering-playbook}"
HANDOFF="${HANDOFF:-$PL/cases/HANDOFF.md}"
[ -f "$HANDOFF" ] || { echo "No $HANDOFF: run handoff.ts first"; exit 1; }
[ -d "$PLAYBOOK_ROOT" ] || { echo "Playbook not found at $PLAYBOOK_ROOT (set PLAYBOOK_ROOT)"; exit 1; }
if grep -q "MISSING" "$HANDOFF"; then echo "HANDOFF.md has MISSING lessons:"; grep -B2 "MISSING" "$HANDOFF" | grep "^## "; fi

status=0
in_bash=0
while IFS= read -r line; do
  case "$line" in
    '```bash') in_bash=1; continue ;;
    '```'*) in_bash=0; continue ;;
  esac
  [ "$in_bash" = 1 ] || continue
  lesson=$(sed -E 's/.*--lesson ([^ ]+).*/\1/' <<<"$line")
  root=$(mktemp -d)
  printf '%-20s ' "$lesson"
  if out=$(cd "$PLAYBOOK_ROOT" && eval "$line --root \"$root\" --dry-run" 2>&1); then
    tail -1 <<<"$out"
  else
    echo "FAILED"; echo "$out" | tail -5; status=1
  fi
done < "$HANDOFF"
grep -E '^- Needs ' "$HANDOFF" | sed 's/^- /  /' || true
exit $status
