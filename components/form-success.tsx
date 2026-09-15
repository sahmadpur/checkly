import { Check } from "lucide-react";

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-success-foreground"><Check className="size-4" aria-hidden />{message}</p>;
}
