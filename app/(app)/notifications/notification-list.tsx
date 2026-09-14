"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllReadAction, markReadAction } from "@/actions/notification";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";

type Row = { id: string; type: string; title: string; body: string; url: string; createdAt: string; readAt: string | null; createdLabel: string };

export function NotificationList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <Button variant="outline" size="sm" disabled={pending || rows.every((r) => r.readAt)} onClick={() => start(async () => { await markAllReadAction(); router.refresh(); })}>Mark all read</Button>
      </div>
      <ul className="divide-y rounded-md border">
        {rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">No notifications.</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className={`flex w-full flex-col items-start gap-0.5 p-3 text-left text-sm ${r.readAt ? "text-muted-foreground" : ""}`}
              onClick={() => start(async () => { if (!r.readAt) await markReadAction(r.id); router.push(r.url); })}>
              <span className={r.readAt ? "" : "font-medium"}>{r.title}</span>
              {r.body && <span className="text-muted-foreground">{r.body}</span>}
              <span className="text-xs text-muted-foreground"><LocalTime iso={r.createdAt} fallback={r.createdLabel} /></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
