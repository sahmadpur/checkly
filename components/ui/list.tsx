import * as React from "react"
import Link from "next/link"
import { cn } from "cn"

/** Bordered white list; rows divide with hairlines. Use ListLink for tappable rows. */
function List({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("divide-y overflow-hidden rounded-xl bg-card ring-1 ring-border", className)} {...props} />
}

function ListRow({ className, ...props }: React.ComponentProps<"li">) {
  return <li className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm", className)} {...props} />
}

function ListEmpty({ children }: { children: React.ReactNode }) {
  return <li className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</li>
}

/** Row that is one big link; `rail` paints a 3px status stripe on the left edge. */
function ListLink({ href, rail, className, children }: { href: string; rail?: string; className?: string; children: React.ReactNode }) {
  return (
    <li className="relative">
      {rail && <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", rail)} />}
      <Link href={href} className={cn("flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-muted/60 active:bg-muted", rail && "pl-5", className)}>
        {children}
      </Link>
    </li>
  )
}

export { List, ListRow, ListEmpty, ListLink }
