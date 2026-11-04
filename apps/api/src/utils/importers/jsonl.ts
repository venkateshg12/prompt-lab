export type Parsed = { line: number; value?: unknown; error?: string };

export const parseJsonl = (content: string): Parsed[] =>
    content
        .split(/\r?\n/)
        .map((text, i) => ({ line: i + 1, text: text.trim() }))
        .filter((l) => l.text.length > 0)
        .map(({ line, text }) => {
            try {
                return { line, value: JSON.parse(text) as unknown };
            } catch (e) {
                return { line, error: `Invalid JSON: ${(e as Error).message}` };
            }
        });
