import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "cn"

/** Native select: the phone's own picker beats a custom popover for one-handed use. */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        data-slot="select"
        className="h-10 w-full appearance-none rounded-lg border border-input bg-card pr-9 pl-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        {...props}
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}

export { Select }
