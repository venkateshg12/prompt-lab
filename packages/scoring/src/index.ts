// Pure scoring: no I/O, no clock, no randomness. Bump on any rule change, so every stored result can
// say which scorer produced it.
export const SCORING_VERSION = "2"; // 2: opt-in nullable enum (Phase 25, reasoning-mini); job-postings scores are unchanged

export * from "./template";
export * from "./renderPrompt";
export * from "./providerSchema";
export * from "./extract";
export * from "./normalize";
export * from "./money";
export * from "./fields";
export * from "./score";
export * from "./canonical";
export * from "./stats";
export * from "./aggregate";
export * from "./summaryTable";
export * from "./exportMarkdown";
export * from "./agreement";
