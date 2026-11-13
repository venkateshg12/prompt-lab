import { RequestHandler } from "express";
import { AppError, appAssert } from "../utils/errors";
import { BAD_REQUEST } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import type { Provider } from "../generated/prisma/client";

// Adapted from the Playbook's Try-it middleware: one shape per provider (it only knew NVIDIA).
const KEY_SHAPES: Record<Exclude<Provider, "fake">, RegExp> = {
    nvidia: /^nvapi-[A-Za-z0-9_-]{20,200}$/,
    openai: /^sk-[A-Za-z0-9_-]{20,200}$/,
    anthropic: /^sk-ant-[A-Za-z0-9_-]{20,200}$/,
    gemini: /^AIza[A-Za-z0-9_-]{30,60}$/,
};

/*
  Moves the visitor's key out of the request before anything else sees it: copied to res.locals and
  deleted from req.headers, so no later `logger.info({ req })`, error handler or Sentry event can print it.
  No key → 400 before any provider code runs (the owner's server key is never a fallback).
 */
export const providerKey: RequestHandler = (req, res, next) => {
    const raw = req.headers["x-provider-key"];
    delete req.headers["x-provider-key"];
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!key) return next(new AppError(BAD_REQUEST, "Add your API key to run the demo.", appErrorCode.DemoKeyMissing));
    res.locals.providerKey = key;
    next();
};

/** Checked in the service, once the model (and so the provider) is known. A light check: never a "validate key" call. */
export const assertKeyShape = (provider: Provider, key: string) =>
    appAssert(provider !== "fake" && KEY_SHAPES[provider].test(key), BAD_REQUEST, `That doesn't look like a ${provider} API key.`, appErrorCode.DemoKeyInvalid);
