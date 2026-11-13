import type { FieldScore } from "@/api/results";

const tone = (s?: FieldScore) => (!s ? "text-muted-foreground" : s.score >= 1 ? "text-emerald-700 dark:text-emerald-400" : s.score > 0 ? "text-amber-700 dark:text-amber-300" : "text-destructive");
const show = (v: unknown) => (v === undefined ? "—" : JSON.stringify(v));

/* One field: the label, then each side's value coloured by its score. Rows whose answers differ are highlighted. */
export function FieldDiffRow({ k, expected, a, b, sa, sb }: { k: string; expected: unknown; a: unknown; b: unknown; sa?: FieldScore; sb?: FieldScore }) {
  const differs = JSON.stringify(a) !== JSON.stringify(b);
  return (
    <tr className={`border-t border-border align-top ${differs ? "bg-amber-500/10" : ""}`} data-testid={`diff-row-${k}`} data-differs={differs}>
      <td className="py-1.5 pr-3 font-mono text-xs">{k}</td>
      <td className="py-1.5 pr-3 font-mono text-xs break-all text-muted-foreground">{show(expected)}</td>
      <td className={`py-1.5 pr-3 font-mono text-xs break-all ${tone(sa)}`} title={sa?.reason}>{show(a)}</td>
      <td className={`py-1.5 font-mono text-xs break-all ${tone(sb)}`} title={sb?.reason}>{show(b)}</td>
    </tr>
  );
}
