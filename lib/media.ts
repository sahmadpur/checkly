export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};
export const extForMime = (mime: string) => EXT[mime] ?? null;

export const mediaKeyPrefix = (orgId: string, instanceId: string, itemId: string) => `org/${orgId}/instances/${instanceId}/${itemId}.`;
export const mediaKey = (orgId: string, instanceId: string, itemId: string, ext: string) => `${mediaKeyPrefix(orgId, instanceId, itemId)}${ext}`;

export function mediaRule(type: "PHOTO" | "VIDEO"): { types: string[]; maxBytes: number; presignSec: number } {
  return type === "PHOTO"
    ? { types: [...PHOTO_TYPES], maxBytes: PHOTO_MAX_BYTES, presignSec: 300 }
    : { types: [...VIDEO_TYPES], maxBytes: VIDEO_MAX_BYTES, presignSec: 600 };
}
