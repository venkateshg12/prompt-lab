import { parse } from "csv-parse/sync";
import type { Parsed } from "./jsonl";

/*
  Columns: id,split,tags,input,expected. `tags` are ';'-separated, `expected` is a JSON string. Quoted
  multi-line inputs work. `info.lines` is the line where the record ENDS, so messages say "near line N".
 */
export const parseCsv = (content: string): Parsed[] => {
    let records: { record: Record<string, string>; info: { lines: number } }[];
    try {
        records = parse(content, { columns: true, skip_empty_lines: true, info: true, bom: true }) as typeof records;
    } catch (e) {
        return [{ line: 1, error: `Invalid CSV: ${(e as Error).message}` }];
    }
    return records.map(({ record, info }) => {
        try {
            return {
                line: info.lines,
                value: {
                    ...record,
                    split: record.split || undefined,
                    tags: record.tags ? record.tags.split(";").map((t) => t.trim()).filter(Boolean) : [],
                    expected: JSON.parse(record.expected ?? ""),
                },
            };
        } catch (e) {
            return { line: info.lines, error: `near line ${info.lines}: expected is not valid JSON: ${(e as Error).message}` };
        }
    });
};
