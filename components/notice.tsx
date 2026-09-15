import { cn } from "cn";

const TONES = {
  warning: "border-warning/40 bg-warning/10 text-warning-foreground",
  info: "border-info/30 bg-info/10 text-info-foreground",
  success: "border-success/30 bg-success/10 text-success-foreground",
};

/** Inline callout. Keep it to one thing the reader should know or do. */
export function Notice({ tone = "info", className, children }: { tone?: keyof typeof TONES; className?: string; children: React.ReactNode }) {
  return <div role="status" className={cn("rounded-lg border px-3 py-2 text-sm", TONES[tone], className)}>{children}</div>;
}
