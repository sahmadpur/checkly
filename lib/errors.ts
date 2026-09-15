import type en from "@/messages/en";

export type ErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "UNAUTHENTICATED";
export type ErrorKey = keyof typeof en.errors;
export type ErrorParams = Record<string, string | number>;

/** `key` is a message key under `errors.*`; translated in lib/actions.ts `run()`. `message` stays the key for logs and tests. */
export class AppError extends Error {
  constructor(public code: ErrorCode, public key: ErrorKey, public params?: ErrorParams) {
    super(key);
    this.name = "AppError";
  }
}

export const forbidden = (key: ErrorKey = "forbidden") => new AppError("FORBIDDEN", key);
export const notFound = (key: ErrorKey = "notFound") => new AppError("NOT_FOUND", key);
export const conflict = (key: ErrorKey, params?: ErrorParams) => new AppError("CONFLICT", key, params);
export const invalid = (key: ErrorKey, params?: ErrorParams) => new AppError("INVALID", key, params);
export const unauthenticated = () => new AppError("UNAUTHENTICATED", "unauthenticated");
