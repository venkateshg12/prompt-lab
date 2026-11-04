// Pure scoring: no I/O, no clock, no randomness. Bump on any rule change, so every stored result can
// say which scorer produced it.
export const SCORING_VERSION = "1"; // Phase 18 adds aggregation; the scoring rules themselves are unchanged

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
