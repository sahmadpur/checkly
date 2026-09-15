import { Check } from "lucide-react";
import type { InstanceItemRow } from "@/lib/services/instance";
import { isItemAnswered } from "@/lib/media";

export function AnswerView({ items, mediaUrls, downloadUrls }: { items: InstanceItemRow[]; mediaUrls: Record<string, string>; downloadUrls: Record<string, string> }) {
  return (
    <ol className="space-y-3">
      {items.map((i) => {
        const answered = isItemAnswered(i);
        return (
          <li key={i.id} className="rounded-xl bg-card p-4 text-sm ring-1 ring-border">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{i.label}{i.required && <span className="text-destructive"> *</span>}</span>
              {!answered && <span className="shrink-0 text-xs text-muted-foreground">Not answered</span>}
            </div>
            {answered && (
              <div className="mt-2">
                {i.type === "CHECKBOX" && i.checked && <span className="inline-flex items-center gap-1.5 font-medium text-success-foreground"><Check className="size-4" aria-hidden /> Done</span>}
                {i.type === "TEXT" && <p className="whitespace-pre-wrap">{i.text}</p>}
                {i.type === "NUMBER" && i.number !== null && <span className="text-lg font-semibold tabular-nums">{i.number}</span>}
                {i.type === "SELECT" && <span className="rounded-full bg-secondary px-2.5 py-0.5 font-medium">{i.choice}</span>}
                {i.type === "PHOTO" && i.fileKey && (mediaUrls[i.id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={mediaUrls[i.id]} alt={i.label} className="max-h-80 rounded-lg" />
                  : <span className="text-muted-foreground">Photo unavailable</span>)}
                {i.type === "VIDEO" && i.fileKey && (mediaUrls[i.id]
                  ? <div className="space-y-1"><video controls playsInline src={mediaUrls[i.id]} className="max-h-80 w-full rounded-lg bg-black" /><a className="text-xs underline underline-offset-4" href={downloadUrls[i.id] ?? mediaUrls[i.id]}>Download video</a></div>
                  : <span className="text-muted-foreground">Video unavailable</span>)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
