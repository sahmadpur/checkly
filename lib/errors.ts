export type ErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "UNAUTHENTICATED";

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "Forbidden") => new AppError("FORBIDDEN", msg);
export const notFound = (msg = "Not found") => new AppError("NOT_FOUND", msg);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const invalid = (msg: string) => new AppError("INVALID", msg);
export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Not signed in");
