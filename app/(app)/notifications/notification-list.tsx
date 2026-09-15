"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff } from "lucide-react";
import { markAllReadAction, markReadAction } from "@/actions/notification";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { List } from "@/components/ui/list";
import { cn } from "cn";

type Row = { id: string; type: string; title: string; body: string; url: string; createdAt: string; readAt: string | null; createdLabel: string };

export function NotificationList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications">
        <Button variant="outline" size="sm" disabled={pending || rows.every((r) => r.readAt)} onClick={() => start(async () => { await markAllReadAction(); router.refresh(); })}>Mark all read</Button>
      </PageHeader>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-12 text-center">
          <BellOff className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-medium">You&apos;re all caught up</p>
        </div>
      ) : (
        <List>
          {rows.map((r) => (
            <li key={r.id} className="relative">
              {!r.readAt && <span aria-hidden className="absolute top-4.5 left-4 size-2 rounded-full bg-primary" />}
              <button type="button" className={cn("flex w-full flex-col items-start gap-0.5 py-3 pr-4 pl-8 text-left text-sm hover:bg-muted/60", r.readAt && "text-muted-foreground")}
                onClick={() => start(async () => { if (!r.readAt) await markReadAction(r.id); router.push(r.url); })}>
                <span className={r.readAt ? "" : "font-semibold"}>{r.title}</span>
                {r.body && <span className="text-muted-foreground">{r.body}</span>}
                <span className="text-xs text-muted-foreground"><LocalTime iso={r.createdAt} fallback={r.createdLabel} /></span>
              </button>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}
