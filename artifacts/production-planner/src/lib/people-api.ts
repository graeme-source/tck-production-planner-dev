/** Response shapes of /api/people (artifacts/api-server/src/routes/people.ts). */
import type { TimelineSpell, TimelineLate } from "@/lib/person-timeline";
import type { RtwForm } from "@/components/rtw-form-editor";

export interface PeoplePolicy { sickInstances: number; lates: number; months: number }

export interface PersonBasics {
  id: number;
  name: string;
  role: string;
  avatarUrl: string | null;
  isActive: boolean;
  linkedToPlanday: boolean;
  probationMonths: number | null;
  jobTitle: string | null;
  contractStartDate: string | null;
}

export interface PersonCard extends PersonBasics {
  formsNeeded: number;
  awayNow: boolean;
  triggers: { sickness: boolean; lates: boolean };
  sickInstances: number;
  lates: number;
  nextMeeting: { date: string; kind: string; title: string | null } | null;
}

export interface OutstandingForm {
  userId: number;
  userName: string;
  start: string;
  end: string;
  days: number;
  types: string[];
  sickness: boolean;
}

export interface PeopleListResponse {
  people: PersonCard[];
  outstanding: OutstandingForm[];
  policy: PeoplePolicy;
  attendance: { syncedAt: string | null; stale: boolean };
}

export interface AttendanceSummary {
  windowStart: string;
  windowEnd: string;
  sickInstances: number;
  sickDays: number;
  lates: number;
  otherAbsenceDays: number;
  otherAbsenceSpells: number;
  triggers: { sickness: boolean; lates: boolean };
  policy: PeoplePolicy;
}

export interface PersonRecordResponse {
  person: PersonBasics;
  window: { from: string; to: string; defaultFrom: string };
  spells: TimelineSpell[];
  lates: TimelineLate[];
  forms: RtwForm[];
  summary: AttendanceSummary;
  attendance: { syncedAt: string | null; stale: boolean; linked: boolean };
}

/** GET /api/people/job-titles — the "Set job titles" screen. `jobTitle` is
 *  the stored title only (null = not set); `contractJobTitle` is the title
 *  on their latest issued contract, offered as a one-tap fill. */
export interface JobTitlesResponse {
  people: Array<{
    id: number;
    name: string;
    avatarUrl: string | null;
    isActive: boolean;
    jobTitle: string | null;
    contractJobTitle: string | null;
  }>;
}

export interface HolidaySummary {
  accountNames: string[];
  yearStart: string | null;
  yearEnd: string | null;
  unit: string;
  balanceNow: number | null;
  balanceAfterBooked: number | null;
  takenThisYear: number;
  upcoming: Array<{ date: string; amount: number }>;
  upcomingTotal: number;
}

export type EmploymentResponse =
  | {
      status: "ok";
      employment: { hiredFrom: string | null; employeeType: string | null; contractRule: string | null; contractRuleNote: string | null };
      holiday: HolidaySummary | null;
      fetchedAt: string;
    }
  | { status: "not_configured" }
  | { status: "unreachable" }
  | { status: "not_linked" };

export const MEETING_KIND_LABEL: Record<string, string> = {
  review: "Review",
  probation: "Probation meeting",
  one_to_one: "1:1",
};

export function roleLabel(role: string): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  return "Team member";
}

export function fmtDay(iso: string, withYear = false): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
  });
}

export function fmtDayRange(start: string, end: string | null, withYear = false): string {
  return !end || end === start ? fmtDay(start, withYear) : `${fmtDay(start, withYear)} – ${fmtDay(end, withYear)}`;
}
