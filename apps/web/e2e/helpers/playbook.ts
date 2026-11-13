import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
  Runs the Playbook's REAL importer (read-only sibling repo) on a Prompt Lab export, without writing to
  that repo: its scripts must load @repo/types as compiled CommonJS (see its scripts/tsconfig.json), and
  its dist/ can be stale, so the package is compiled into a temp dir and mapped in with a temp tsconfig.
 */
export const PLAYBOOK = path.join(os.homedir(), "Code/prompt-engineering-playbook");
const SITE = path.join(PLAYBOOK, "apps/site");
export const playbookAvailable = () => existsSync(path.join(SITE, "scripts/import-prompt-lab.ts"));

let tsconfig: string | null = null;
const prepare = () => {
  if (tsconfig) return tsconfig;
  const dir = mkdtempSync(path.join(os.tmpdir(), "pl-playbook-"));
  execFileSync("pnpm", ["exec", "tsc", "-p", ".", "--outDir", path.join(dir, "dist"), "--declaration", "false", "--declarationMap", "false", "--sourceMap", "false"], {
    cwd: path.join(PLAYBOOK, "packages/types"),
    stdio: "pipe",
  });
  mkdirSync(path.join(dir, "cfg"));
  tsconfig = path.join(dir, "cfg/tsconfig.json");
  writeFileSync(tsconfig, JSON.stringify({
    extends: path.join(SITE, "scripts/tsconfig.json"),
    compilerOptions: { baseUrl: path.join(SITE, "scripts"), paths: { "@/*": ["../src/*"], "@repo/types": [path.join(dir, "dist/index.js")] } },
  }));
  return tsconfig;
};

/** `import-prompt-lab.ts <args>` in the Playbook's site; returns stdout. Always pass --dry-run unless you mean to write there. */
export const runPlaybookImporter = (args: string[]) =>
  execFileSync("pnpm", ["exec", "tsx", "--tsconfig", prepare(), "scripts/import-prompt-lab.ts", ...args], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
