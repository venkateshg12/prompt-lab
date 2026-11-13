/** Shown for split = test. The checkbox is the deliberate intent the API demands (`confirmFinal`). */
export function TestRunCallout({ reused, confirmed, onConfirm }: { reused: boolean; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-purple-500/40 bg-purple-500/5 p-3" data-testid="test-callout">
      <p className="text-xs text-foreground">The test set is for final numbers. Develop and tune on dev.</p>
      {reused && (
        <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="test-reused-warning">
          The test set was already used by an earlier run (or a test example was moved to dev since), so this run will be marked <strong>test reused</strong> in every export and published page. Test once.
        </p>
      )}
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} data-testid="final-run" /> This is a final run
      </label>
    </div>
  );
}
