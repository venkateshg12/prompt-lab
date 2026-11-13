/*
  Anything key-shaped becomes "[key]" (NVIDIA, Anthropic, OpenAI, Gemini). The last line of defence for
  any message that could still reach a visitor or a log; the first lines are fixed messages and redaction.
 */
export const scrubKeys = (text: string): string => text.replace(/(nvapi-|sk-ant-|sk-|AIza)[A-Za-z0-9_-]{8,}/g, "[key]");
