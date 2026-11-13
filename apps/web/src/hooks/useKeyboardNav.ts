import { useEffect, useState } from "react";

/*
  j / k move, o opens, c compares, ? toggles the help. Never fires while the user is typing in a field,
  and never with a modifier held (Ctrl+C must still copy).
 */
export const useKeyboardNav = (count: number, handlers: { open: (i: number) => void; compare: (i: number) => void; help?: () => void }) => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "j") setIndex((i) => Math.min(i + 1, Math.max(count - 1, 0)));
      else if (e.key === "k") setIndex((i) => Math.max(i - 1, 0));
      else if (e.key === "o") handlers.open(index);
      else if (e.key === "c") handlers.compare(index);
      else if (e.key === "?" && handlers.help) handlers.help();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, index, handlers]);
  return [Math.min(index, Math.max(count - 1, 0)), setIndex] as const;
};
