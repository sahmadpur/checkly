"use client";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-sm space-y-3 py-16 text-center">
      <p className="text-lg font-semibold">Something went wrong.</p>
      <p className="text-sm text-muted-foreground">Try again. If it keeps happening, reload the page.</p>
      <Button variant="outline" onClick={reset}>Try again</Button>
    </div>
  );
}
