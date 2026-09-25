/**
 * How a return-to-work form row is read and shaped for the browser — shared
 * by the return-to-work routes and a person's record in People.
 */
import { sql } from "drizzle-orm";

export interface FormRow extends Record<string, unknown> {
  id: number;
  user_id: number;
  user_name: string | null;
  absence_start: string;
  absence_end: string | null;
  absence_type: string | null;
  return_date: string | null;
  reason_category: string | null;
  reason_details: string | null;
  support_notes: string | null;
  doctor_seen: boolean | null;
  work_related: boolean | null;
  manager_name: string | null;
  colleague_signed_at: string | null;
  manager_signed_at: string | null;
  status: string;
  created_at: string;
}

export const formSelect = sql`
  SELECT f.id, f.user_id, u.name AS user_name, f.absence_start::text, f.absence_end::text,
         f.absence_type, f.return_date::text, f.reason_category, f.reason_details, f.support_notes,
         f.doctor_seen, f.work_related,
         f.manager_name, f.colleague_signed_at, f.manager_signed_at, f.status, f.created_at
  FROM return_to_work_forms f JOIN app_users u ON u.id = f.user_id
`;

export function shapeForm(r: FormRow) {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    userName: r.user_name,
    absenceStart: r.absence_start,
    absenceEnd: r.absence_end,
    absenceType: r.absence_type,
    returnDate: r.return_date,
    reasonCategory: r.reason_category,
    reasonDetails: r.reason_details,
    supportNotes: r.support_notes,
    doctorSeen: r.doctor_seen,
    workRelated: r.work_related,
    managerName: r.manager_name,
    colleagueSignedAt: r.colleague_signed_at,
    managerSignedAt: r.manager_signed_at,
    status: r.status,
    createdAt: r.created_at,
  };
}

