import { PLACEHOLDERS, PLACEHOLDER_RE, type Placeholder } from "@repo/types";

/*
  One pass over the TEMPLATE: substituted values are never scanned again, so a posting that contains
  the text `{{instructions}}` is not expanded. A known placeholder without a value renders as empty text;
  an unknown `{{x}}` is left as written (the prompt schema rejects unknown placeholders on save).
 */
export const renderTemplate = (template: string, values: Partial<Record<Placeholder, string>>): string =>
    template.replace(PLACEHOLDER_RE, (match, name: string) => {
        const value = values[name as Placeholder];
        if (value !== undefined) return value;
        return (PLACEHOLDERS as readonly string[]).includes(name) ? "" : match;
    });
