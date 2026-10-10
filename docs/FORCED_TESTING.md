# Forced testing — test requests

**Built 2026-10-10** (migration `0159_test_requests.sql`). Objectives E and F.

Some changes can only be proved in real production — on the building station
tomorrow morning, after 2pm, on a dispatch day. A **test request** names who
must try a change and when; each of them gets a "Can you test this?" card
(like the swipe-panel walkthrough) until they answer or a manager closes it.

- **Who:** if it came from an issue report, the person who reported it is
  always asked; anyone else chosen is asked too.
- **When:** any combination of a page pattern (`/plans/*/station/building` =
  "next time you build"; `*` is one part of the path), a not-before date and
  a London time-of-day window, plus `whenText` in plain words for the card.
- **Answers:** Works and easy to understand / Works but confusing / Doesn't
  work, with an optional note (dictation) and photo — or "I can't test this"
  with a reason. "Not now" puts it away for two hours.
- **Results:** Analytics → Test requests (`/test-requests`, managers and
  admins). Every answer is added to the originating issue's thread; anything
  but a clean pass rings the asker's bell (Graeme's for deploy-made ones).
- Rules: `artifacts/api-server/src/lib/test-request-rules.ts` (who, status)
  and `artifacts/production-planner/src/lib/test-requests.ts` (when the card
  shows), both unit-tested.

## Attaching test requests at deploy time (Claude)

After Graeme confirms a deploy, for each shipped change that needs a real-world
check, call the machine API with the issue pipeline token (the same
`ISSUE_PIPELINE_TOKEN` as `docs/ISSUE_PIPELINE.md`; never echo it):

```bash
curl -s -X POST "$APP_URL/api/issue-pipeline/machine/test-requests" \
  -H "Authorization: Bearer $ISSUE_PIPELINE_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "title": "Edit numbers on the building station",
    "steps": "When you have finished a batch, tap Edit numbers and change the count. Does the total update? Is it clear what to do?",
    "onlyOnPath": "/plans/*/station/building",
    "whenText": "Next time you build",
    "andonIssueId": 317,
    "testerEmails": ["someone@thecalzonekitchen.co.uk"],
    "fixRef": "abc1234"
  }'
```

Fields: `title`, `steps` (required); `linkPath` (in-app page for "Take me
there"), `onlyOnPath`, `notBefore` (ISO with offset), `dailyFrom` /
`dailyUntil` ("HH:MM" London), `whenText`, `andonIssueId` (its reporter is
added automatically), `testerIds` and/or `testerEmails` (active people only),
`fixRef`, `createdByName` (default "Claude (deploy)"). 201 → `{ id, testerIds }`;
400 explains what's wrong in plain words.

Read results: `GET /api/issue-pipeline/machine/test-requests?since=ISO&status=problems`
(statuses: waiting, in_progress, passed, problems, skipped, closed) — each
request with every tester's answer and note. Follow up on `problems` before
calling the change done.

Write the steps in the tester's language: what changed, exactly what to do,
and the question ("does it work, and is it easy to understand?"). Only ask
for a test where it adds something — not for every commit.
