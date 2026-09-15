import { Camera, Check } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { cn } from "cn";

const ITEMS = [
  { label: "Beds made", done: true },
  { label: "Towels restocked", done: true },
  { label: "Kitchen photo", done: true, photo: true },
  { label: "Notes for next guest", done: false },
];

/** Decorative panel for signed-out screens: the product, drawn with the product's own parts. */
export function AuthVisual() {
  return (
    <div className="relative flex h-full flex-col justify-between gap-6 overflow-hidden bg-primary px-6 py-6 text-primary-foreground lg:p-12">
      <svg aria-hidden viewBox="0 0 64 64" className="pointer-events-none absolute -right-16 -bottom-16 size-64 opacity-[0.08] lg:-right-24 lg:-bottom-24 lg:size-[36rem]">
        <path d="M17 34l10 10 20-22" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <Wordmark inverted className="text-2xl" />

      <div className="relative my-10 hidden lg:block">
        <div aria-hidden className="absolute inset-x-8 -top-5 h-24 rotate-[-3deg] rounded-xl bg-white/25" />
        <div className="relative mx-auto max-w-sm rotate-[2deg] rounded-xl bg-card p-5 text-card-foreground shadow-2xl shadow-black/25">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Villa Azul · due 11:00</p>
              <p className="font-heading text-lg font-semibold">Turnover clean</p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">Open</span>
          </div>
          <ul className="mt-4 space-y-2">
            {ITEMS.map((it) => (
              <li key={it.label} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 text-sm", it.done ? "border-primary/40 bg-accent/40" : "border-input")}>
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border-2", it.done ? "border-primary bg-primary text-white" : "border-input")}>
                  {it.done && <Check className="size-3" strokeWidth={3} aria-hidden />}
                </span>
                <span className={cn("flex-1", !it.done && "text-muted-foreground")}>{it.label}</span>
                {it.photo && <span className="flex h-7 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground"><Camera className="size-4" aria-hidden /></span>}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium">3 of 4 required done</p>
              <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-muted"><div className="h-full w-3/4 rounded-full bg-primary" /></div>
            </div>
            <span className="rounded-lg bg-primary/40 px-4 py-2 text-sm font-medium text-white">Submit</span>
          </div>
        </div>
      </div>

      <div className="relative max-w-sm">
        <p className="font-heading text-xl font-semibold text-balance lg:text-3xl">Every property, every shift, checked.</p>
        <p className="mt-2 hidden text-sm text-white/75 lg:block">Build the checklist once. Workers see what is due today and finish it on their phone, photos included. You review what comes back.</p>
      </div>
    </div>
  );
}
