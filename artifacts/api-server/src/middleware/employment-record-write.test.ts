import { describe, expect, it, vi, beforeEach } from "vitest";

// No database. The fake answers the guard's three lookups by what the query
// asks for: the actor (joins people_access_grants), the subject (app_users by
// id) and a row's owner (anything else).
const facts = {
  actor: null as null | { id: number; email: string | null; planday_employee_id: number | null; is_active: boolean; granted: boolean },
  subject: null as null | { id: number; email: string | null; planday_employee_id: number | null },
  owner: null as null | number,
};
function queryText(q: unknown): string {
  const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.map(c => {
    const v = (c as { value?: unknown })?.value;
    return Array.isArray(v) ? v.join("") : "";
  }).join(" ");
}
vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>().catch(() => ({}));
  return {
    ...real,
    db: {
      execute: async (q: unknown) => {
        const text = queryText(q);
        if (text.includes("people_access_grants")) return { rows: facts.actor ? [facts.actor] : [] };
        if (text.includes("SELECT id, email, planday_employee_id FROM app_users")) return { rows: facts.subject ? [facts.subject] : [] };
        return { rows: facts.owner == null ? [] : [{ owner: facts.owner }] };
      },
      select: () => { throw new Error("no db in tests"); },
    },
    pool: { query: async () => ({ rows: [] }), connect: async () => { throw new Error("no db in tests"); } },
  };
});

process.env.DATABASE_URL ??= "postgres://test/never-connected";

const guardMod = await import("./employment-record-write");
const { employmentRecordWrite, fromParam, isEmploymentRecordWriteGuard, employmentRecordGuardOptions } = guardMod;
const { FOUNDER_EMAIL } = await import("../lib/founder-email");
const { EMPLOYMENT_RECORD_WRITE_REFUSAL } = await import("../lib/people-write-access");

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } };

/**
 * Every router that writes anything on a person's employment record, and
 * the write routes in each that are deliberately NOT behind the guard (with
 * why). A new write route in any of these files fails this test until it
 * either carries employmentRecordWrite(...) or is added here with a reason.
 */
const ROUTERS: Record<string, { load: () => Promise<{ default: unknown }>; notRecordWrites: Record<string, string> }> = {
  "people.ts": { load: () => import("../routes/people"), notRecordWrites: {} },
  // Read-only since migration 0178 (your own record); reviews are written through people-reviews.ts.
  "employee-reviews.ts": { load: () => import("../routes/employee-reviews"), notRecordWrites: {} },
  "people-review-notes.ts": { load: () => import("../routes/people-review-notes"), notRecordWrites: {} },
  "person-documents.ts": { load: () => import("../routes/person-documents"), notRecordWrites: {} },
  "return-to-work.ts": { load: () => import("../routes/return-to-work"), notRecordWrites: {} },
  "uploaded-contracts.ts": { load: () => import("../routes/uploaded-contracts"), notRecordWrites: {} },
  "contracts.ts": {
    load: () => import("../routes/contracts"),
    notRecordWrites: {
      "PUT /template": "the master template, not anyone's record (founder only)",
      "POST /preview": "renders a contract without saving anything (founder only)",
    },
  },
  "staff-emergency-contacts.ts": {
    load: () => import("../routes/staff-emergency-contacts"),
    notRecordWrites: {
      "POST /team/:userId/view": "a read — POST only because it writes the who-looked log row",
      "POST /people/:userId/view": "a read — POST only because it writes the who-looked log row",
    },
  },
  "onboarding.ts": { load: () => import("../routes/onboarding"), notRecordWrites: {} },
  "people-reviews.ts": {
    load: () => import("../routes/people-reviews"),
    notRecordWrites: {
      "POST /classifications": "the classification LIST, not anyone's record (founder / admin with People access)",
      "PATCH /classifications/:id": "the classification LIST, not anyone's record (founder / admin with People access)",
      "POST /stages": "the stage LIST, not anyone's record (founder / admin with People access)",
      "PATCH /stages/:id": "the stage LIST, not anyone's record (founder / admin with People access)",
      "PATCH /letter-templates/:id": "the letter TEMPLATES, not anyone's record (founder only)",
      "PATCH /hr-settings": "who letter emails come from + Needs-attention lead times — settings, not anyone's record (founder only)",
    },
  },
  "people-letters-mine.ts": { load: () => import("../routes/people-letters-mine"), notRecordWrites: {} },
  "starter-forms.ts": { load: () => import("../routes/starter-forms"), notRecordWrites: {} },
  "people-hours.ts": { load: () => import("../routes/people-hours"), notRecordWrites: {} },
  "people-access.ts": {
    load: () => import("../routes/people-access"),
    notRecordWrites: { "PUT /users/:userId": "the People access grant itself — founder only (checkPeopleAccessChange)" },
  },
  "employees.ts": {
    load: () => import("../routes/employees"),
    notRecordWrites: { "POST /attendance/unmatched-dismiss": "hides a Planday 'invite to planner' card — an app setting, no one's record" },
  },
};

/** Routers with no write routes at all (checked, so a write added later must be guarded). */
const READ_ONLY = new Set(["people-hours.ts", "employee-reviews.ts"]);

/** The self-service routes, and the kind each one is. Anything else is editors only. */
const SELF_SERVICE_ROUTES: Record<string, string> = {
  "staff-emergency-contacts.ts PUT /me": "own_emergency_contact",
  "onboarding.ts PUT /me": "own_onboarding_form",
  "onboarding.ts POST /me/documents": "own_onboarding_form",
  "onboarding.ts DELETE /me/documents/:id": "own_onboarding_form",
  "contracts.ts POST /:id/sign": "sign_own_contract",
  "starter-forms.ts PUT /mine/:formType": "own_starter_forms",
  "starter-forms.ts POST /mine/:formType/sign": "own_starter_forms",
  "return-to-work.ts POST /": "own_rtw_form",
  "return-to-work.ts PATCH /:id": "own_rtw_form",
  "return-to-work.ts POST /:id/complete": "own_rtw_form",
  "return-to-work.ts POST /:id/attachments": "own_rtw_form",
  "return-to-work.ts DELETE /attachments/:attachmentId": "own_rtw_form",
  "people-letters-mine.ts POST /mine/:id/read": "own_letter_acknowledge",
  "people-letters-mine.ts POST /mine/:id/acknowledge": "own_letter_acknowledge",
};

function writeRoutes(router: unknown) {
  return ((router as { stack: Layer[] }).stack)
    .filter(l => l.route)
    .map(l => l.route!)
    .filter(r => !r.methods["get"])
    .map(r => ({ key: `${Object.keys(r.methods)[0]!.toUpperCase()} ${r.path}`, handles: r.stack.map(s => s.handle) }));
}

describe("every employment-record write route carries the guard", () => {
  for (const [file, spec] of Object.entries(ROUTERS)) {
    it(file, async () => {
      const { default: router } = await spec.load();
      // Hours worked and your own review record are read-only today; every other file really has writes
      // (so an import that silently found nothing can't pass).
      if (READ_ONLY.has(file)) expect(writeRoutes(router)).toEqual([]);
      else expect(writeRoutes(router).length).toBeGreaterThan(0);
      for (const r of writeRoutes(router)) {
        const guard = r.handles.find(isEmploymentRecordWriteGuard);
        if (spec.notRecordWrites[r.key]) {
          expect(guard, `${file} ${r.key} is listed as not a record write`).toBeUndefined();
          continue;
        }
        expect(guard, `${file} ${r.key} has no employmentRecordWrite guard`).toBeDefined();
        // The guard runs before the handler (the handler is always last).
        expect(r.handles.indexOf(guard)).toBeLessThan(r.handles.length - 1);
        const kind = employmentRecordGuardOptions(guard)?.selfService;
        expect(kind ?? null, `${file} ${r.key} self-service kind`).toBe(SELF_SERVICE_ROUTES[`${file} ${r.key}`] ?? null);
      }
      // Nothing listed as an exception has quietly disappeared or been renamed.
      const keys = writeRoutes(router).map(r => r.key);
      for (const listed of Object.keys(spec.notRecordWrites)) expect(keys, `${file}: ${listed}`).toContain(listed);
    });
  }

  it("every self-service route listed above exists", async () => {
    for (const listed of Object.keys(SELF_SERVICE_ROUTES)) {
      const [file, ...rest] = listed.split(" ");
      const { default: router } = await ROUTERS[file!]!.load();
      expect(writeRoutes(router).map(r => r.key), listed).toContain(rest.join(" "));
    }
  });
});

// ── The guard's answers ────────────────────────────────────────────────────

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    locals: {} as Record<string, unknown>,
    status(code: number) { res.statusCode = code; return res; },
    json(b: unknown) { res.body = b; return res; },
  };
  return res;
}

async function run(guard: ReturnType<typeof employmentRecordWrite>, req: object) {
  const res = fakeRes();
  const next = vi.fn();
  await guard(req as never, res as never, next);
  return { res, next };
}

const LORNA = { id: 6, email: "lorna@example.co.uk", planday_employee_id: 106, is_active: true, granted: true };
const GRAEME = { id: 2, email: FOUNDER_EMAIL, planday_employee_id: 100, is_active: true, granted: true };
const TEST_ADMIN = { id: 24, email: "claude-test@example.co.uk", planday_employee_id: null, is_active: true, granted: false };
const SAM = { id: 40, email: "sam@example.co.uk", planday_employee_id: 140 };

describe("employmentRecordWrite", () => {
  const onPerson = employmentRecordWrite({ subject: fromParam("userId") });
  const selfService = employmentRecordWrite({ subject: fromParam("userId"), selfService: "own_rtw_form" });
  const hidden = employmentRecordWrite({ subject: fromParam("userId"), refuseAs404: true });
  beforeEach(() => { facts.actor = null; facts.subject = null; facts.owner = null; });

  it("refuses an admin without People access with 403 and the plain message", async () => {
    facts.actor = TEST_ADMIN; facts.subject = SAM;
    const { res, next } = await run(onPerson, { session: { userId: 24 }, params: { userId: "40" } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: EMPLOYMENT_RECORD_WRITE_REFUSAL });
  });

  it("lets Lorna change someone else's record, as an editor", async () => {
    facts.actor = LORNA; facts.subject = SAM;
    const { res, next } = await run(onPerson, { session: { userId: 6 }, params: { userId: "40" } });
    expect(next).toHaveBeenCalled();
    expect(res.locals["employmentRecordRight"]).toBe("editor");
  });

  it("refuses Lorna on her own record", async () => {
    facts.actor = LORNA; facts.subject = { id: 6, email: LORNA.email, planday_employee_id: 106 };
    const { res, next } = await run(onPerson, { session: { userId: 6 }, params: { userId: "6" } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("lets Lorna use a self-service route on her own record — as 'self', not editor", async () => {
    facts.actor = LORNA; facts.subject = { id: 6, email: LORNA.email, planday_employee_id: 106 };
    const { res, next } = await run(selfService, { session: { userId: 6 }, params: { userId: "6" } });
    expect(next).toHaveBeenCalled();
    expect(res.locals["employmentRecordRight"]).toBe("self");
  });

  it("refuses a self-service route on someone else's record", async () => {
    facts.actor = TEST_ADMIN; facts.subject = SAM;
    const { res, next } = await run(selfService, { session: { userId: 24 }, params: { userId: "40" } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("lets the founder change his own record", async () => {
    facts.actor = GRAEME; facts.subject = { id: 2, email: FOUNDER_EMAIL, planday_employee_id: 100 };
    const { next, res } = await run(onPerson, { session: { userId: 2 }, params: { userId: "2" } });
    expect(next).toHaveBeenCalled();
    expect(res.locals["employmentRecordRight"]).toBe("editor");
  });

  it("an inactive account is refused even with a grant", async () => {
    facts.actor = { ...LORNA, is_active: false }; facts.subject = SAM;
    const { res } = await run(onPerson, { session: { userId: 6 }, params: { userId: "40" } });
    expect(res.statusCode).toBe(403);
  });

  it("a by-id route can refuse as 404 so it never confirms the id exists", async () => {
    facts.actor = TEST_ADMIN; facts.subject = SAM;
    const { res } = await run(hidden, { session: { userId: 24 }, params: { userId: "40" } });
    expect(res.statusCode).toBe(404);
  });

  it("a row whose account has gone is still judged — only an editor passes", async () => {
    facts.actor = TEST_ADMIN; facts.subject = null;
    expect((await run(onPerson, { session: { userId: 24 }, params: { userId: "999" } })).res.statusCode).toBe(403);
    facts.actor = LORNA;
    expect((await run(onPerson, { session: { userId: 6 }, params: { userId: "999" } })).next).toHaveBeenCalled();
  });

  it("no person in the request: the handler answers its own 400/404", async () => {
    facts.actor = TEST_ADMIN;
    const { next } = await run(onPerson, { session: { userId: 24 }, params: { userId: "abc" } });
    expect(next).toHaveBeenCalled();
  });

  it("not signed in: 401", async () => {
    const { res, next } = await run(onPerson, { session: {}, params: { userId: "40" } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
