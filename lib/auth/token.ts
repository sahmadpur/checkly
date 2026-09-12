import { randomBytes } from "node:crypto";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export const createToken = () => randomBytes(32).toString("hex");
export const expiresIn = (ms: number) => new Date(Date.now() + ms);
export const isExpired = (date: Date) => date.getTime() <= Date.now();
