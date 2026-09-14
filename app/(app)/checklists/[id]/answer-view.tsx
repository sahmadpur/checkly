import type { InstanceItemRow } from "@/lib/services/instance";
import { isAnswered } from "@/lib/services/instance";

export function AnswerView({ items, mediaUrls }: { items: InstanceItemRow[]; mediaUrls: Record<string, string> }) {
  return (
    <ol className="space-y-3">
      {items.map((i) => (
        <li key={i.id} className="rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{i.label}{i.required && <span className="text-destructive"> *</span>}</span>
            {!isAnswered(i) && <span className="text-xs text-muted-foreground">Not answered</span>}
          </div>
          <div className="mt-1">
            {i.type === "CHECKBOX" && (i.checked ? "✓ Done" : "")}
            {i.type === "TEXT" && <p className="whitespace-pre-wrap">{i.text}</p>}
            {i.type === "NUMBER" && i.number !== null && String(i.number)}
            {i.type === "SELECT" && i.choice}
            {i.type === "PHOTO" && i.fileKey && (mediaUrls[i.id]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={mediaUrls[i.id]} alt={i.label} className="max-h-80 rounded-md" />
              : <span className="text-muted-foreground">Photo unavailable</span>)}
            {i.type === "VIDEO" && i.fileKey && (mediaUrls[i.id]
              ? <div className="space-y-1"><video controls playsInline src={mediaUrls[i.id]} className="max-h-80 w-full rounded-md" /><a className="text-xs underline" href={mediaUrls[i.id]} download>Download video</a></div>
              : <span className="text-muted-foreground">Video unavailable</span>)}
          </div>
        </li>
      ))}
    </ol>
  );
}
