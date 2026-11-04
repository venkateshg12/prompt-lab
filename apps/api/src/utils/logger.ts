import pino from "pino";
import type { DestinationStream } from "pino";
import { LOG_LEVEL, NODE_ENV, SERVICE_NAME } from "../constants/env";
import { getRequestContext } from "./requestContext";

const both = (...keys: string[]) => keys.flatMap((key) => [key, `*.${key}`]);

/*
  Keys whose values never reach a log line. Paths, not a recursive scan: pino compiles them once.
  The rule is still "log ids, not content"; this list is the backstop for code that forgets.
 */
const REDACT_PATHS = [
    ...both("password", "currentPassword", "newPassword", "token", "accessToken", "refreshToken",
            "verificationToken", "resetToken", "apiKey", "secret", "authorization", "cookie"),
    "headers.authorization", "headers.cookie",
    // Provider keys: the owner's (env) and a demo visitor's (X-Provider-Key, Phase 23).
    ...both("providerKey", "nvidiaApiKey", "openaiApiKey", "anthropicApiKey", "geminiApiKey"),
    'headers["x-provider-key"]', '*.headers["x-provider-key"]',
    // Model I/O and test data: stored in PostgreSQL with their run, never in logs.
    ...both("rawOutput", "extractedText", "parsedJson", "messages", "system", "prompt"),
    ...both("input", "expected", "secondLabel"),
    // Personal data. Logs are kept longer and read by more people than the database.
    ...both("email"),
];

// pino-pretty is a devDependency, so a container started with NODE_ENV=development (the compose
// stack) does not have it. Fall back to plain JSON lines instead of crashing at import time.
const canPrettyPrint = (): boolean => {
    try {
        require.resolve("pino-pretty");
        return true;
    } catch {
        return false;
    }
};

let current: DestinationStream = pino.destination(1); // stdout
const sink: DestinationStream = { write: (line: string) => current.write(line) };
/** Tests only: send every log line to `stream` (Phase 28's log capture). */
export const setLogDestination = (stream: DestinationStream) => {
    current = stream;
};

const options: pino.LoggerOptions = {
    level: LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    // Every line carries the request (or job) it belongs to, and who was acting.
    mixin() {
        const context = getRequestContext();
        return context ? { ...context } : {};
    },
    base: { service: SERVICE_NAME },
    timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger =
    NODE_ENV === "development" && canPrettyPrint()
        ? pino({
              ...options,
              transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
          })
        : pino(options, sink);
