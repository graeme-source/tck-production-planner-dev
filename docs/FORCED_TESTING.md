# Forced testing — test requests

**Built 2026-10-10** (migrations `0159_test_requests.sql`, `0160_forced_testing_round2.sql`).
Objectives E and F.

Some changes can only be proved in real production — on the building station
tomorrow morning, after 2pm, on a dispatch day. A **test request** names who
must try a change and where/when; each of them gets a "Can you test this?"
card (like the swipe-panel walkthrough).

## Only when Graeme opts in

Test requests are made **case by case, by Graeme or a manager, from the app**:
"Request a test" on the Test requests page (Analytics → Test requests), on an
issue in the Fix queue, or on an improvement's page. Not every change needs
one.

## How it behaves — no nagging

- **Who:** if it came from an issue report or an improvement idea, the person
  who reported it / logged it (the lead name) is always asked; anyone else
  chosen is asked too.
- **When:** a test tied to a **place** (page pattern, e.g.
  `/plans/*/station/fried-chicken`; `*` is one part of the path) pops up when
  the tester **arrives** there — each arrival, never on a timer. A test with
  no place pops up **once**, the next time they're signed in after it's due
  (optional not-before date and London time-of-day window).
- **Choices on the card:** "Take me there" / "I'll try it now", **"Put it on
  my to-do list — I'll do it later"**, or "I've already tried it — answer
  now". The X does the same as the to-do choice. Once it's on their to-do
  list it **never pops up again**; the to-do's link (`/?testRequest=ID`)
  brings the card back when they choose. A no-place test they walked away
  from goes onto their to-do list by itself instead of coming back.
- **Answers:** Works and easy to understand / Works but confusing / Doesn't
  work, with an optional note (dictation) and photo — or "I can't test this"
  with a reason. Answering ticks the to-do off; closing the request removes
  an open to-do. Nothing ever blocks work.
- **Results:** Analytics → Test requests (`/test-requests`, managers and
  admins). Every answer is added to the originating issue's thread and/or
  the improvement's comments; anything but a clean pass rings the asker's
  bell.
- Rules: `artifacts/api-server/src/lib/test-request-rules.ts` (who, status,
  the to-do) and `artifacts/production-planner/src/lib/test-requests.ts`
  (when the card shows), both unit-tested.

## The machine endpoint — not for routine deploys

`/api/issue-pipeline/machine/test-requests` (bearer `ISSUE_PIPELINE_TOKEN`,
same as `docs/ISSUE_PIPELINE.md`) still exists, but **a deploy or pipeline
session must NOT create test requests unless Graeme asked for that specific
test** ("ask Ana to test the fried chicken timer when she's next on the
station"). Don't attach them to deploys by default.

When he has asked, create it with:

```bash
curl -s -X POST "$APP_URL/api/issue-pipeline/machine/test-requests" \
  -H "Authorization: Bearer $ISSUE_PIPELINE_TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "…", "steps": "…", "onlyOnPath": "/plans/*/station/building",
        "whenText": "Next time you build", "andonIssueId": 317,
        "testerEmails": ["someone@thecalzonekitchen.co.uk"] }'
```

Fields: `title`, `steps` (required); `linkPath`, `onlyOnPath`, `notBefore`
(ISO with offset), `dailyFrom` / `dailyUntil` ("HH:MM" London), `whenText`,
`andonIssueId` and/or `improvementId` (their reporter / submitter is added
automatically), `testerIds` and/or `testerEmails`, `fixRef`, `createdByName`.
Read results with `GET …/test-requests?since=ISO&status=problems`.
