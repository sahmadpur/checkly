import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** Every screen opens with one of these: optional back link, title, one-line context, actions on the right. */
export function PageHeader({ title, back, description, children }: {
  title: React.ReactNode; back?: { href: string; label: string }; description?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 space-y-1">
        {back && (
          <Link href={back.href} className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden /> {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold text-balance sm:text-3xl">{title}</h1>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
