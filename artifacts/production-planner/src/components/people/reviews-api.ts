/**
 * Data for the employment record's entries and letters (server:
 * routes/people-reviews.ts — private People PIN, founder or People access,
 * never your own record). React Query for reads; every write goes through
 * employee-reviews' api(), so a timed-out People PIN asks for the PIN
 * straight away instead of losing what was typed.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Classification, EntryStatus, FitForWork, LetterStatus, LetterTemplate, MeetingStatus, MeetingType, NoteKind, ProbationOutcome, Rating,
  ReviewBadge, Stage,
} from "@workspace/people-reviews";
import { peopleFetch, peopleRetry } from "@/hooks/use-people-gate";
import { api } from "@/components/employee-reviews";

export interface RecordLetter {
  id: number;
  templateId: number | null;
  title: string;
  body: string;
  status: LetterStatus;
  signatoryName: string | null;
  documentId: number | null;
  filedAt: string | null;
  sentAt: string | null;
  sentByName: string | null;
  emailedTo: string | null;
  emailedAt: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One part of a review's write-up — private to its author until shared. */
export interface ReviewNote {
  id: number;
  entryId: number | null;
  kind: NoteKind;
  title: string | null;
  body: string;
  visibility: "private" | "shared";
  sharedAt: string | null;
  dueDate: string | null;
  doneAt: string | null;
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordEntry {
  id: number;
  userId: number;
  classificationId: number;
  entryDate: string;
  title: string;
  notes: string | null;
  notesUpdatedByName: string | null;
  notesUpdatedAt: string | null;
  status: EntryStatus;
  closedOn: string | null;
  reviewStart: string | null;
  reviewEnd: string | null;
  outcome: string | null;
  nextReviewDate: string | null;
  stageId: number | null;
  warningExpiresOn: string | null;
  warningWithdrawnAt: string | null;
  warningWithdrawnReason: string | null;
  rating: Rating | null;
  payFrom: string | null;
  payTo: string | null;
  payEffectiveOn: string | null;
  probationOutcome: ProbationOutcome | null;
  probationNewEnd: string | null;
  fitForWork: FitForWork | null;
  /** The review itself (migration 0178): booked | held | cancelled; null = no meeting. */
  meetingStatus: MeetingStatus | null;
  heldAt: string | null;
  meetingType: MeetingType | null;
  meetingDate: string | null;
  meetingTime: string | null;
  meetingAttendees: string | null;
  meetingChecklist: string[];
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  history: Array<{ action: string; detail: string | null; at: string; by: string | null }>;
  letters: RecordLetter[];
  /** Its write-up, already filtered by the server to what this viewer may read. */
  writeUp: ReviewNote[];
}

export interface RecordAttendance {
  sickInstances: number;
  sickDays: number;
  lates: number;
  otherAbsenceDays: number;
  triggers: { sickness: boolean; lates: boolean };
  policy: { sickInstances: number; lates: number; months: number };
  windowStart: string;
}

export interface PersonRecordEntries {
  person: { id: number; name: string; email: string | null; isActive: boolean };
  today: string;
  viewerId: number;
  canEditLists: boolean;
  classifications: Classification[];
  stages: Stage[];
  attendance: RecordAttendance | null;
  entries: RecordEntry[];
  probation: ProbationFact | null;
  periodMonths: number[];
  /** Old diary notes that were never part of a meeting (migration 0178). */
  looseNotes: ReviewNote[];
}

export interface ProbationFact { userId: number; startDate: string; endDate: string; outcome: "passed" | "not_passed" | null; derived: boolean }

export interface BadgeRow { userId: number; badge: ReviewBadge | null; liveWarningUntil: string | null }

export const personEntriesKey = (userId: number) => ["people-record-entries", "person", userId] as const;
export const recordBadgesKey = ["people-record-entries", "badges"] as const;
export const letterTemplatesKey = ["people-record-entries", "letter-templates"] as const;

/** One person's entries. `ready` from usePeopleReady (the PIN gate has asked). */
export function usePersonEntries(userId: number, ready: boolean) {
  return useQuery<PersonRecordEntries>({
    queryKey: personEntriesKey(userId),
    queryFn: () => peopleFetch<PersonRecordEntries>(`/people-reviews/person/${userId}`),
    enabled: ready,
    retry: peopleRetry,
    // Every load is audited — don't refetch just because the tab regained focus.
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

/** Everyone's badge for the People list (never the viewer's own). */
export function useRecordBadges(ready: boolean) {
  return useQuery<{ badges: BadgeRow[] }>({
    queryKey: recordBadgesKey,
    queryFn: () => peopleFetch<{ badges: BadgeRow[] }>("/people-reviews/badges"),
    enabled: ready,
    retry: peopleRetry,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export function useLetterTemplates(ready: boolean) {
  return useQuery<{ templates: LetterTemplate[]; mergeFields: Array<{ key: string; label: string }>; canEdit: boolean }>({
    queryKey: letterTemplatesKey,
    queryFn: () => peopleFetch(`/people-reviews/letter-templates`),
    enabled: ready,
    retry: peopleRetry,
    staleTime: 5 * 60_000,
  });
}

/** POST/PATCH to the record API (PIN time-outs handled by api()). */
export function recordSend<T = unknown>(method: "POST" | "PATCH", path: string, body: unknown = {}): Promise<T> {
  return api<T>(`/people-reviews${path}`, { method, body: JSON.stringify(body) });
}

/** DELETE on the record API (a review note is hidden, never hard-deleted). */
export function recordDelete(path: string): Promise<void> {
  return api<void>(`/people-reviews${path}`, { method: "DELETE" });
}

/** Refresh what entries feed: the person's entries, the list badges. */
export function useRefreshEntries(userId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: personEntriesKey(userId) });
    void qc.invalidateQueries({ queryKey: recordBadgesKey });
    // A Timekeeping / Attendance entry can answer a policy trigger.
    void qc.invalidateQueries({ queryKey: ["people-record", userId] });
    void qc.invalidateQueries({ queryKey: ["people-list"] });
  };
}

export const LETTER_PREVIEW_URL = (id: number) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/people-reviews/letters/${id}/preview.pdf`;
