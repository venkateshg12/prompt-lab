import type { FieldDetail, FieldScore } from "@/api/results";

const show = (v: unknown) => (v === undefined ? "—" : JSON.stringify(v));

/* expected · actual · score · reason, plus the normalised values when they differ from the raw ones. */
export function FieldScoreRow({ score, detail, highlight }: { score: FieldScore; detail?: FieldDetail; highlight?: boolean }) {
  const normDiffers = detail && (detail.normExpected !== undefined || detail.normPredicted !== undefined) &&
    (JSON.stringify(detail.normExpected) !== JSON.stringify(detail.expected) || JSON.stringify(detail.normPredicted) !== JSON.stringify(detail.predicted));
  const tone = score.score >= 1 ? "text-emerald-700 dark:text-emerald-400" : score.score > 0 ? "text-amber-700 dark:text-amber-300" : "text-destructive";
  return (
    <tr className={`border-t border-border align-top ${highlight ? "bg-amber-500/5" : ""}`} data-testid={`field-row-${score.key}`}>
      <td className="py-1.5 pr-3 font-mono text-xs text-foreground">{score.key}</td>
      <td className="py-1.5 pr-3 font-mono text-xs break-all">{show(detail?.expected)}</td>
      <td className="py-1.5 pr-3 font-mono text-xs break-all">{show(detail?.predicted)}</td>
      <td className={`py-1.5 pr-3 text-xs tabular-nums ${tone}`}>{score.score.toFixed(2)}</td>
      <td className="py-1.5 pr-3 text-xs" data-testid="field-reason">{score.reason}</td>
      <td className="py-1.5 font-mono text-[11px] text-muted-foreground break-all">
        {normDiffers ? `${show(detail!.normExpected)} vs ${show(detail!.normPredicted)}` : ""}
        {detail?.precision !== undefined ? ` P ${detail.precision.toFixed(2)} · R ${detail.recall?.toFixed(2)}` : ""}
      </td>
    </tr>
  );
}
