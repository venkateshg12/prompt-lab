/** Integer micro-dollars → "$0.0123". Small amounts keep 4 decimals so a $0.0004 run doesn't print "$0.00". */
export const usd = (micros: number): string => {
  const dollars = micros / 1_000_000;
  return `$${dollars >= 1 ? dollars.toFixed(2) : dollars.toFixed(4)}`;
};

export const shortDate = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export const duration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
