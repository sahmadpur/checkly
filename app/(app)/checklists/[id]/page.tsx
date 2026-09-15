import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { getInstance } from "@/lib/services/instance";
import { presignDownload, storageConfigured } from "@/lib/storage";
import { AppError } from "@/lib/errors";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/notice";
import { AnswerView } from "./answer-view";
import { ReviewForm } from "./review-form";
import { FillForm } from "./fill-form";

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  let inst;
  try {
    inst = await getInstance(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const mediaUrls: Record<string, string> = {};
  // A plain <a download> cannot rename a cross-origin file, so videos get a second URL that forces the save.
  const downloadUrls: Record<string, string> = {};
  if (storageConfigured()) {
    for (const i of inst.items) {
      if (!i.fileKey) continue;
      mediaUrls[i.id] = await presignDownload(i.fileKey);
      if (i.type === "VIDEO") downloadUrls[i.id] = await presignDownload(i.fileKey, 900, { attachment: true });
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">{inst.templateName} <StatusBadge status={inst.status} overdue={inst.overdue} /></span>}
        back={{ href: `/properties/${inst.propertyId}`, label: inst.propertyName }}
        description={<>
          Due <LocalTime iso={inst.dueAt.toISOString()} fallback={formatDateTime(inst.dueAt)} className={inst.overdue ? "font-medium text-destructive" : undefined} /> · {inst.assigneeName}
          {inst.scheduleName && <> · from schedule {inst.scheduleName}</>}
        </>}
      />
      {inst.status === "REJECTED" && inst.reviewComment && (
        <Notice tone="warning">
          <p className="font-medium">Sent back{inst.reviewedByName ? ` by ${inst.reviewedByName}` : ""}</p>
          <p className="whitespace-pre-wrap">{inst.reviewComment}</p>
        </Notice>
      )}
      {inst.status === "APPROVED" && inst.reviewComment && <Notice tone="success">Reviewer note: {inst.reviewComment}</Notice>}
      {inst.canFill ? <FillForm instance={inst} mediaUrls={mediaUrls} /> : <AnswerView items={inst.items} mediaUrls={mediaUrls} downloadUrls={downloadUrls} />}
      {inst.canReview && <ReviewForm instanceId={inst.id} />}
    </div>
  );
}
