"use client";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { deletePushSubscriptionAction, savePushSubscriptionAction, setPreferencesAction } from "@/actions/notification";
import { currentPushSubscription, pushSupported, subscribeToPush } from "@/lib/client/push";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/section";

const noop = () => () => {};

export function NotificationPrefs({ notifyPush, notifyEmail, hasEmail, vapidKey }: { notifyPush: boolean; notifyEmail: boolean; hasEmail: boolean; vapidKey: string }) {
  const [error, setError] = useState<string | null>(null);
  const [deviceSubscribed, setDeviceSubscribed] = useState<boolean | null>(null);
  const [pending, start] = useTransition();
  // pushSupported() reads `window`, which the server never has: reading it directly in
  // render would mismatch on hydration. Match LocalTime's fix — false on the server and
  // on the first client render, then the real value once mounted.
  const supported = useSyncExternalStore(noop, () => pushSupported() && !!vapidKey, () => false);

  useEffect(() => { currentPushSubscription().then((s) => setDeviceSubscribed(!!s)).catch(() => setDeviceSubscribed(false)); }, []);

  const toggleDevice = () => start(async () => {
    try {
      setError(null);
      if (deviceSubscribed) {
        const sub = await currentPushSubscription();
        if (sub) { await deletePushSubscriptionAction(sub.endpoint); await sub.unsubscribe(); }
        setDeviceSubscribed(false);
      } else {
        const sub = await subscribeToPush(vapidKey);
        const json = sub.toJSON();
        const r = await savePushSubscriptionAction({ endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth }, userAgent: navigator.userAgent.slice(0, 300) });
        if (!r.ok) throw new Error(r.error);
        setDeviceSubscribed(true);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  });

  const setPref = (p: { notifyPush?: boolean; notifyEmail?: boolean }) => start(async () => { const r = await setPreferencesAction(p); if (!r.ok) setError(r.error); });

  return (
    <Section title="Notifications" description="How Checkly reaches you when something is assigned, due or reviewed." card>
      <div className="space-y-4">
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" defaultChecked={notifyPush} disabled={pending} onChange={(e) => setPref({ notifyPush: e.target.checked })} /> Push notifications</label>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" defaultChecked={notifyEmail} disabled={pending || !hasEmail} onChange={(e) => setPref({ notifyEmail: e.target.checked })} /> Email notifications{!hasEmail && <span className="text-muted-foreground">(add an email to your profile first)</span>}</label>
        {supported ? (
          <Button type="button" variant="outline" disabled={pending || deviceSubscribed === null} onClick={toggleDevice}>
            {deviceSubscribed ? "Turn off push on this device" : "Turn on push on this device"}
          </Button>
        ) : <p className="text-sm text-muted-foreground">Push isn&apos;t available in this browser. On iPhone, add Checkly to the Home Screen first.</p>}
        <FormError message={error} />
      </div>
    </Section>
  );
}
