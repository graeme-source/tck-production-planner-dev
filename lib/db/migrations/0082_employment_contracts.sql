-- Employment contracts (Graeme, 2026-09-07).
--
-- The founder keeps ONE master contract template in the system, edits it in
-- the app, and generates per-person contracts from it: pick the employee,
-- type the rate of pay / job title / weekly hours / start date, and the
-- filled contract lands in that employee's hub — visible to that employee
-- and the founder, nobody else. Serves Objective H (a personal experience
-- for every team member).
--
-- contract_templates.body carries {{placeholders}} which MUST all be
-- resolved at generation time (the renderer refuses to issue a contract
-- with any left over — fail loud, never a half-filled contract).
--
-- employment_contracts.body is the filled, immutable snapshot: later edits
-- to the template never change what somebody was issued. acknowledged_at is
-- the employee's in-app "I have read and agree" stamp — not a legal
-- e-signature, but a clear record of who has seen what, and once set the
-- contract can no longer be deleted.

CREATE TABLE IF NOT EXISTS contract_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Master employment contract',
  body TEXT NOT NULL,
  default_job_title TEXT NOT NULL DEFAULT 'Food Production Operative',
  default_weekly_hours TEXT NOT NULL DEFAULT '41.25',
  updated_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employment_contracts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES contract_templates(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  rate_of_pay TEXT NOT NULL,
  weekly_hours TEXT NOT NULL,
  start_date DATE NOT NULL,
  issue_date DATE NOT NULL,
  issued_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS employment_contracts_user_idx ON employment_contracts (user_id);

-- Seed the master from the reviewed NEW MASTER CONTRACT.docx (2026-09-07),
-- with the wording fixes Graeme approved on import:
--   "Contact of employment" -> "CONTRACT OF EMPLOYMENT"; "by credit
--   transfer"; "complied"/"a medical certificate"; "reserves"; "Managing
--   Director's"; headings separated from their text; and the employee
--   notice bands mirrored to match the employer's (two-way 5-years rule,
--   Graeme 2026-09-07).
INSERT INTO contract_templates (name, body)
SELECT 'Master employment contract', $tck_contract$CONTRACT OF EMPLOYMENT

Between:

THE CALZONE KITCHEN
3 Wood End
Nash
Milton Keynes
MK17 0EL

And

{{employee_name}}

On: {{issue_date}}

Your employment begins on {{start_date}}.

JOB TITLE
You are employed as {{job_title}} and your duties will be as advised by the Production Manager. Your duties may be modified from time to time to suit the needs of the business.

JOB DESCRIPTION
Your role within the business will be to improve the processes associated with the production and dispatching of calzones and other related products associated with the business. This will be carried out by taking part in production and other associated processes. Your duties will be advised by the Manager and will be subject to change as the business evolves.

PLACE OF WORK
You will normally be required to work at Unit A, Oak Tree Barn, Rectory Farm, Church Lane, Great Brickhill. If necessary, you will work at and if requested change your normal place of work to any branch office, which the Company has already set up or may set up within a 10 mile radius of your normal working place.

HOURS OF WORK
Your weekly hours will be {{weekly_hours}}. Shift lengths vary from day to day and may also change with the evolving needs of the business. You may be required to work additional hours when authorised and as necessitated by the needs of the business. Your hours will vary from week to week but will always average at least the above stated amount over a 3 month period. You are required to attend work punctually and be ready to commence duties at your scheduled start time. Persistent lateness or failure to comply with working hours requirements may result in disciplinary action in accordance with the Company's procedures.

REMUNERATION
{{rate_of_pay}} per hour, payable monthly on the last working day of the calendar month by credit transfer as detailed on your pay statement. Unpaid leave may be granted at the Managing Director's discretion to participate in other business activities such as events, related to the Company. The company pay period is from the 25th of the previous month, to the 24th of the current month.

PROBATIONARY PERIOD
Your employment is subject to a 6 month probationary period from the start date of this contract. The business reserves the right to extend any probation period at their discretion.

ANNUAL LEAVE AND PUBLIC/BANK HOLIDAYS
Your holiday year begins on 1st January and ends on 31st December each year. Holiday entitlement is accrued at a rate of 12.07% (equivalent to 28 days per year for full-time employees, inclusive of bank holiday entitlement).
The Company currently closes on Christmas Day, Boxing Day and New Year's Day. If your normal working days fall on these dates, you will not be required to work and will be required to take these days as part of your annual leave entitlement. Where insufficient holiday entitlement remains, unpaid leave may be requested subject to approval by your line manager.
The Company may also close on other bank holidays. Where this occurs and the day falls on your normal working day, you will be required to take the day as part of your annual leave entitlement.
Where the Company remains open on bank holidays, you will be expected to work on those days if they fall within your normal working pattern. Where multiple employees are scheduled to work, the Company may allocate working requirements on a fair and reasonable basis across the team, taking into account business needs.
The Company will, where possible, seek volunteers to work on bank holidays. However, where there are insufficient volunteers, employees may be required to work in accordance with the above.
Requests for annual leave on bank holidays are subject to approval and may be limited depending on operational requirements.
The Company reserves the right to require employees to take annual leave on specified dates, including bank holidays and periods of business closure, by giving appropriate notice.
In the event of termination of employment, holiday entitlement will be calculated as 1/12th of the annual entitlement for each completed month of service during that holiday year. Any accrued but untaken holiday will be paid. Where holiday has been taken in excess of accrued entitlement, the appropriate deduction will be made from final pay.

CATERING AND EVENTS
As part of your role, you may be required to support external catering events and business activities. These may take place outside of normal working hours, including evenings and weekends.
You will be expected to participate in a reasonable number of such events each year (typically 2-4), subject to business needs.
The Company will provide reasonable notice of such events wherever possible. Working time will be scheduled in line with your overall contractual hours and in accordance with Working Time Regulations.

SICKNESS PAY AND CONDITIONS
You are entitled to Statutory Sick Pay ("SSP") during periods of sickness absence. Company sick pay will be at the discretion of Management. To qualify, you must have had six months service with the Company and have complied with the requirements on notification of absence and the provision of a medical certificate. Maximum entitlement in any 12 month period is:

0-6 months service - SSP
Over 6 months service - 1 week's full pay

CAPABILITY AND DISCIPLINARY PROCEDURES
Any failure to perform your duties may be subject to disciplinary or capability procedures being taken against you. These will be taken at the discretion of your line manager or Director.

CAPABILITY/DISCIPLINARY APPEAL PROCEDURE
Should you be dissatisfied with any decision to take action or dismiss you on capability/disciplinary grounds, you should apply, either verbally or in writing, to a Director within five working days of the decision you are complaining against.

GRIEVANCE PROCEDURE
Should you feel aggrieved at any matter relating to your employment, you should raise the grievance with your Line Manager either verbally or in writing.

SHORT-TIME WORKING AND LAY-OFF
The Company reserves the right, where there is a reduction in work or other business need, to reduce your working hours and/or pay on a temporary basis, or lay you off without pay (other than statutory guarantee payments where applicable). The Company will provide as much notice as reasonably practicable in such circumstances.

FLEXIBILITY
The Company reserves the right to make reasonable changes to your duties, hours of work, and place of work to meet the needs of the business.

DEDUCTIONS FROM WAGES
The Company reserves the right to make deductions from your wages or other payments due to you for any overpayment, holiday taken in excess of entitlement, loss or damage to Company property caused by negligence, or any other sums owed to the Company.

CONFIDENTIALITY
During and after your employment, you must not disclose any confidential information relating to the Company, including recipes, processes, suppliers, pricing, or business operations.

SUSPENSION
The Company reserves the right to suspend you on full pay while investigating any disciplinary matter.

VARIATION OF TERMS
The Company reserves the right to make reasonable changes to these terms and conditions. You will be notified of any such changes in writing.

NOTICE OF TERMINATION TO BE GIVEN BY EMPLOYER
Under 1 month's service - Nil.
1 month up to successful completion of your probationary period - 1 week.
On successful completion of your probationary period but less than 5 years' service - 1 month.
5 years' service or more - 1 week for each completed year of service to a maximum of 12 weeks after 12 years.

NOTICE OF TERMINATION TO BE GIVEN BY EMPLOYEE
Under 1 month's service - Nil.
1 month up to successful completion of your probationary period - 1 week.
On successful completion of your probationary period but less than 5 years' service - 1 month.
5 years' service or more - 1 week for each completed year of service to a maximum of 12 weeks after 12 years.

PAY IN LIEU OF NOTICE
We reserve the contractual right to give pay in lieu of all or any part of the above notice by either party.

PENSION AND PENSION SCHEME
When required, we will operate a contributory pension scheme to which you will be auto-enrolled into (subject to the conditions of the scheme). Further details are available from your Line Manager.


Signed by Graeme Carter,
Managing Director (on behalf of The Calzone Kitchen)

.......................................................

Date: {{issue_date}}


Signed by {{employee_name}}

.......................................................

Date: .......................................................$tck_contract$
WHERE NOT EXISTS (SELECT 1 FROM contract_templates);
