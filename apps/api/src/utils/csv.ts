const FORMULA_START = /^[=+\-@\t\r]/;

export const csvText = (value: string | null | undefined): string => {
  if (value === null || value === undefined) return "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const csvNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined || isNaN(value)) return "";
  return String(value);
};

export const csvLine = (cells: string[]): string => cells.join(",") + "\r\n";

export const UTF8_BOM = "﻿";
