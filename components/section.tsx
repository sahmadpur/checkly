import { cn } from "cn";

/** A titled block on a page. `card` wraps the body in a white panel (forms); lists bring their own panel. */
export function Section({ title, description, actions, card, className, children }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; card?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {card ? <div className="rounded-xl bg-card p-4 ring-1 ring-border sm:p-5">{children}</div> : children}
    </section>
  );
}
