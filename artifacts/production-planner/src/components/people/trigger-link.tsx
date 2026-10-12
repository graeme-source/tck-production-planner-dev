/**
 * "Does this review deal with the attendance trigger?" (Graeme, 2026-10-12:
 * a maternity planning 1:1 was taken as the sickness review — "we need a way
 * to choose what we're going to attach it to").
 *
 * No / Sickness / Lates / Both, plus Automatic (nothing picked: only a
 * review classified as attendance or timekeeping evidence counts). Asked
 * only once a trigger has been reached for this person, or when the review
 * already has a link (showTriggerChoice). Autosaves with a visible state;
 * onChanged refreshes the banner straight away.
 */
import {
  ANSWERS_TRIGGER, ANSWERS_TRIGGER_LABEL, ANSWERS_TRIGGER_QUESTION, showTriggerChoice, type AnswersTrigger,
} from "@workspace/people-reviews";
import { AutoChoice } from "./review-fields";
import { recordSend, type PersonRecordEntries, type RecordEntry } from "./reviews-api";

export const TRIGGER_HINT: Record<AnswersTrigger, string> = {
  none: "Not about attendance — leave the trigger as it is",
  sickness: "This is the sickness review",
  lates: "This is the lates review",
  both: "Covers sickness and lates",
};

export function TriggerLinkField({ entry, data, onChanged }: {
  entry: RecordEntry;
  data: PersonRecordEntries;
  onChanged: () => void;
}) {
  if (!showTriggerChoice(data.triggerReview, entry.answersTrigger)) return null;
  return (
    <div className="space-y-1.5">
      <AutoChoice label={ANSWERS_TRIGGER_QUESTION} value={entry.answersTrigger} columns={2}
        allowClear="Automatic — only if it's about attendance or timekeeping"
        options={ANSWERS_TRIGGER.map(v => ({ value: v, label: ANSWERS_TRIGGER_LABEL[v], hint: TRIGGER_HINT[v] }))}
        onSave={async v => { await recordSend("PATCH", `/entries/${entry.id}`, { answersTrigger: v }); onChanged(); }} />
    </div>
  );
}
