import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// Precache the built shell only. No runtime caching: everything else (API calls,
// RSC payloads, HTML navigations) always goes to the network; no offline data by design.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [],
});

self.addEventListener("push", (event) => {
  const data = (() => { try { return event.data?.json() as { title: string; body: string; url: string; tag: string }; } catch { return null; } })();
  if (!data) return;
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, data: { url: data.url }, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/today";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const target = new URL(url, self.location.origin).href;
    for (const c of all) { if (c.url === target && "focus" in c) return c.focus(); }
    if (all[0] && "navigate" in all[0]) { await all[0].navigate(target); return all[0].focus(); }
    return self.clients.openWindow(target);
  })());
});

serwist.addEventListeners();
