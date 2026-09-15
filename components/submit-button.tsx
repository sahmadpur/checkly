"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function SubmitButton({ pending, children, className = "w-full sm:w-auto" }: { pending: boolean; children: React.ReactNode; className?: string }) {
  const t = useTranslations("common");
  return (
    <Button type="submit" disabled={pending} className={className}>
      {pending ? t("pleaseWait") : children}
    </Button>
  );
}
