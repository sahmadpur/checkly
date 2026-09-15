"use client";
import { Button } from "@/components/ui/button";

export function SubmitButton({ pending, children, className = "w-full sm:w-auto" }: { pending: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Button type="submit" disabled={pending} className={className}>
      {pending ? "Please wait…" : children}
    </Button>
  );
}
