"use client";
import { Button } from "@/components/ui/button";

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Please wait…" : children}
    </Button>
  );
}
