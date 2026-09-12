"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = "checkly.installDismissed";

export function InstallBanner() {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(KEY)) return; } catch {}
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (standalone) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must match SSR (false) then sync from a browser-only API after mount, or hydration mismatches.
    if (isIos) setIos(true);
    const handler = (e: Event) => { e.preventDefault(); setEvt(e as BIP); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!evt && !ios) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch {} setEvt(null); setIos(false); };

  return (
    <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border bg-accent/40 p-3 text-sm md:hidden">
      <span>{ios ? "Install: tap Share, then “Add to Home Screen”." : "Install Checkly for quick access."}</span>
      <div className="flex gap-2">
        {evt && <Button size="sm" onClick={async () => { await evt.prompt(); dismiss(); }}>Install</Button>}
        <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
      </div>
    </div>
  );
}
