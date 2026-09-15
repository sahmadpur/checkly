import { cn } from "cn";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="64" height="64" rx="16" fill="#1e6b5a" />
      <path d="M17 34l10 10 20-22" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-heading text-xl font-bold tracking-tight", className)}>
      <Mark /> Checkly
    </span>
  );
}
