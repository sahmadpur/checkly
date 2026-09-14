import type { InstanceDetail } from "@/lib/services/instance";
import { AnswerView } from "./answer-view";
export function FillForm({ instance, mediaUrls }: { instance: InstanceDetail; mediaUrls: Record<string, string> }) {
  return <AnswerView items={instance.items} mediaUrls={mediaUrls} />;
}
