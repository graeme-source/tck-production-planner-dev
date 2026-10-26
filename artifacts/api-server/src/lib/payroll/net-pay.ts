// Estimated monthly take-home pay for the payroll report (objective B).
//
// PURE — no DB, no network. This is an ESTIMATE for the founder's monthly
// payroll summary, not a payslip: the real figures come from the payroll
// bureau. It works on a month-1 (non-cumulative) basis, so it ignores
// year-to-date tax, student loans, benefits in kind and salary sacrifice.
//
// Figures, UK tax year 2026/27 (England):
//   Source: https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027
//   (fetched 2026-10-26)
//   - Income tax: personal allowance £12,570; basic rate 20% on the first
//     £37,700 above it (i.e. to £50,270); higher 40% to £125,140; additional
//     45% above £125,140. Personal allowance falls £1 for every £2 of income
//     over £100,000.
//   - Class 1 NI, employee, category A: primary threshold £1,048/month,
//     upper earnings limit £4,189/month; 8% between them, 2% above the UEL.
//   Pension qualifying earnings:
//   Source: https://www.gov.uk/workplace-pensions/what-you-your-employer-and-the-government-pay
//   - Lower limit £6,240/yr (£520/month), upper limit £50,270/yr
//     (£4,189/month). The page states no tax year; these limits have been
//     frozen since 2021/22 and are used here for 2026/27.

export const TAX_YEAR = "2026/27";

const PERSONAL_ALLOWANCE = 12_570;
const BASIC_RATE_BAND = 37_700;
const ADDITIONAL_RATE_THRESHOLD = 125_140;
const TAPER_THRESHOLD = 100_000;

const NI_PRIMARY_THRESHOLD_MONTHLY = 1_048;
const NI_UPPER_EARNINGS_LIMIT_MONTHLY = 4_189;
const NI_MAIN_RATE = 0.08;
const NI_UPPER_RATE = 0.02;

const PENSION_QE_LOWER_MONTHLY = 520;
const PENSION_QE_UPPER_MONTHLY = 4_189;
const DEFAULT_PENSION_PCT = 5;

export interface NetPayEstimate {
  gross: number;
  tax: number;
  ni: number;
  pension: number;
  net: number;
  assumptions: string[];
}

const pennies = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Annual income tax on an annual gross, code 1257L, England. */
function annualIncomeTax(annualGross: number): number {
  const taper = Math.max(0, (annualGross - TAPER_THRESHOLD) / 2);
  const allowance = Math.max(0, PERSONAL_ALLOWANCE - taper);
  const taxable = Math.max(0, annualGross - allowance);
  const basic = Math.min(taxable, BASIC_RATE_BAND);
  const higher = Math.max(0, Math.min(taxable, ADDITIONAL_RATE_THRESHOLD) - BASIC_RATE_BAND);
  const additional = Math.max(0, taxable - ADDITIONAL_RATE_THRESHOLD);
  return basic * 0.2 + higher * 0.4 + additional * 0.45;
}

export function estimateNetPay(
  monthlyGross: number,
  opts: { pensionPct?: number; taxCode?: "1257L" } = {},
): NetPayEstimate {
  const gross = pennies(Math.max(0, Number.isFinite(monthlyGross) ? monthlyGross : 0));
  const pensionPct = Math.max(0, opts.pensionPct ?? DEFAULT_PENSION_PCT);

  // Month 1 basis: this month's pay as if it were 1/12 of the year.
  const tax = pennies(annualIncomeTax(gross * 12) / 12);

  const niMain = Math.max(0, Math.min(gross, NI_UPPER_EARNINGS_LIMIT_MONTHLY) - NI_PRIMARY_THRESHOLD_MONTHLY) * NI_MAIN_RATE;
  const niUpper = Math.max(0, gross - NI_UPPER_EARNINGS_LIMIT_MONTHLY) * NI_UPPER_RATE;
  const ni = pennies(niMain + niUpper);

  const qualifying = Math.max(0, Math.min(gross, PENSION_QE_UPPER_MONTHLY) - PENSION_QE_LOWER_MONTHLY);
  const pension = pennies(qualifying * (pensionPct / 100));

  const net = pennies(gross - tax - ni - pension);

  return {
    gross,
    tax,
    ni,
    pension,
    net,
    assumptions: [
      `UK ${TAX_YEAR} rates, England, tax code ${opts.taxCode ?? "1257L"}, month-1 (non-cumulative) basis — ignores pay earlier in the tax year.`,
      "Employee National Insurance category A: 8% between £1,048 and £4,189 a month, 2% above.",
      `Employee pension ${pensionPct}% of qualifying earnings (£520–£4,189 a month), taken after tax with no tax-relief adjustment.`,
      "Excludes student loans, salary sacrifice, benefits in kind and any other deductions.",
    ],
  };
}
