import { parse as parseYaml } from "yaml";

/*
  cases/<case>/prompts/<key>.md:

    ---
    key: v2-few-shot
    technique: few_shot
    fewShot: [jp_004, jp_017]      # example refs (dev only), resolved to ids by the importer
    notes: ...
    ---
    ## system
    ...
    ## user
    ...

  The `## user` section becomes the template.
 */
export type PromptFile = {
    key: string;
    technique: string;
    system: string;
    template: string;
    fewShotRefs: string[];
    notes: string | null;
};

export const parsePromptFile = (text: string, filename: string): PromptFile => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    if (!match) throw new Error(`${filename}: missing front matter (--- … ---)`);
    const meta = parseYaml(match[1]!) as Record<string, unknown> | null;
    if (!meta || typeof meta.key !== "string" || typeof meta.technique !== "string") {
        throw new Error(`${filename}: front matter needs "key" and "technique"`);
    }

    const sections: Record<string, string> = {};
    let current: string | null = null;
    for (const line of match[2]!.split(/\r?\n/)) {
        const heading = /^##\s+(system|user)\s*$/.exec(line);
        if (heading) {
            current = heading[1]!;
            sections[current] = "";
        } else if (current) {
            sections[current] += line + "\n";
        }
    }
    const system = sections.system?.trim();
    const template = sections.user?.trim();
    if (!system || !template) throw new Error(`${filename}: needs both "## system" and "## user" sections`);

    const fewShot = Array.isArray(meta.fewShot) ? meta.fewShot.map(String) : [];
    return {
        key: meta.key,
        technique: meta.technique,
        system,
        template,
        fewShotRefs: fewShot,
        notes: typeof meta.notes === "string" ? meta.notes : null,
    };
};
