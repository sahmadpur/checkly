import webpush from "web-push";

let configured = false;
export function pushConfigured() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return false;
  if (!configured) { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); configured = true; }
  return true;
}

/** Returns "gone" when the subscription is dead (404/410) so the caller can delete it. */
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; url: string; tag: string }) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600 });
    return "ok" as const;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone" as const;
    throw e;
  }
}
