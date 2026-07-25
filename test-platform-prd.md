# Product Requirements Document (PRD)
## Test Attending Platform — v2 (Multi-Test + Analytics Upgrade)

**Owner:** Deepak
**Purpose of this doc:** Feed directly into an AI coding assistant (Cursor) to extend the existing quiz app into a proper test-attending platform with question uploads, configurable timers, and analytics.

---

## 1. Background — What Already Exists

A working single-quiz app built with Node.js/Express + `data.json` storage:

- **Participant view** (`public/index.html`, `public/script.js`): 10 fixed MCQs, 15-min countdown timer, lock-in answers, optimistic UI, `POST /api/answer`.
- **Admin panel** (`public/admin.html`, `public/admin.js`): password-gated (`admin123`), live score/status tracker, full quiz editor (edit questions/options/correct answer), "Publish New Quiz" which overwrites the single quiz and resets answers.
- **Backend** (`server.js`): `GET /api/questions`, `POST /api/questions` (admin publish), `POST /api/answer`. Single `data.json` file holds one quiz's state at a time.
- **Sharing**: `start-poll.bat` starts the server, opens admin panel, and tunnels via `localtunnel`.

**Core limitation:** the system only ever holds *one* quiz at a time, with no history. Publishing a new quiz destroys the old one's results. There's no concept of "tests" as separate entities, no question upload, and no analytics beyond the live single-quiz tracker.

---

## 2. Goals for v2

1. Let the teacher/friend create a **test** (a named, timed set of questions) by **uploading a CSV** or **typing questions manually** in a form — or a mix of both.
2. Let the teacher set the **timer duration per test** (not hardcoded to 15 min).
3. Let Deepak (the sole participant) **attempt any published/active test** and submit it.
4. Keep a **permanent history of every test and every attempt** — nothing gets wiped on publish anymore.
5. Provide an **analytics dashboard** with two views:
   - **Current test view** — live status of the in-progress attempt (like today's admin tracker).
   - **Historical view** — trends across all past tests (score over time, per-question/topic weak spots, time spent).
6. Keep the stack simple (Node/Express, file-based storage is fine) since it's single-participant — no need for user accounts/auth beyond the existing admin password.

**Out of scope for v2** (explicitly, so the AI assistant doesn't over-build): multi-student accounts, real-time multiplayer, cloud database, role-based user management. Note in section 8 how to keep the door open for these later without over-engineering now.

---

## 3. Users

| Role | Who | Can do |
|---|---|---|
| **Teacher/Admin** | Deepak's friend/teacher | Create tests (CSV or manual), set timer, edit questions, publish/activate a test, view live + historical analytics |
| **Participant** | Deepak (only) | See the currently active/published test, attempt it within the timer, submit, view own results & history |

---

## 4. Data Model Changes

Replace the single `data.json` blob with a small structured store. File-based JSON is fine (e.g. `db/tests.json`, `db/submissions.json`), or use `lowdb` for convenience — but keep it file-based, not a hosted DB.

### 4.1 `Test` object
```json
{
  "id": "test_2026-07-25_001",
  "title": "Daily GK Quiz - 25 Jul",
  "createdAt": "2026-07-25T09:00:00Z",
  "timerMinutes": 15,
  "status": "draft | published | active | completed | archived",
  "questions": [
    {
      "id": "q1",
      "text": "What is the capital of France?",
      "options": ["Berlin", "Madrid", "Paris", "Rome"],
      "correctIndex": 2,
      "topic": "Geography"
    }
  ]
}
```
- `topic` field is optional but strongly recommended — it's what powers "weak area" analytics later.
- `status` lifecycle: `draft` (being edited) → `published` (visible, not yet started) → `active` (timer running, participant attempting) → `completed` (submitted or time's up) → `archived` (kept for history, not shown as "current").

### 4.2 `Submission` object
```json
{
  "testId": "test_2026-07-25_001",
  "startedAt": "2026-07-25T09:05:00Z",
  "submittedAt": "2026-07-25T09:14:32Z",
  "timeTakenSeconds": 572,
  "answers": [
    { "questionId": "q1", "selectedIndex": 2, "correct": true, "answeredAt": "2026-07-25T09:05:40Z" }
  ],
  "score": 8,
  "totalQuestions": 10
}
```
- One submission per test (since it's solo). Keep `testId` as the link.
- `answeredAt` per question enables "time spent per question" analytics.

Keep both files append-only for `Submission` (history never overwritten) and let `Test` be updated in place until `completed`, then frozen.

---

## 5. Functional Requirements

### 5.1 Teacher: Create/Upload a Test
- New admin screen: **"Create Test"**.
- Two input methods, both writing to the same `Test.questions` structure:
  - **CSV upload**: define and document a fixed column schema:
    ```
    question,optionA,optionB,optionC,optionD,correctAnswer,topic
    ```
    - **Headers are case-insensitive and order-insensitive** — normalize header names on parse (`Question`, `question`, `QUESTION` all map to the same field). Match by lowercasing and trimming each header before mapping to the schema.
    - `correctAnswer` accepts `A/B/C/D` (case-insensitive).
    - `topic` optional, defaults to `"General"` if blank. See topic-handling note below (5.1a).
    - No cap on question count — a test can have any number of questions, from 1 to however many the CSV/form contains. UI (both admin list and participant view) should scroll/paginate gracefully rather than assume ~10.
    - Parse with a library like `csv-parse` or `papaparse` (client-side is fine to avoid a server upload endpoint if simpler).
    - Show a **preview table** of parsed questions before saving, with inline validation errors (missing option, invalid correctAnswer, etc.) highlighted per row.
  - **Manual form**: existing quiz editor UI, generalized to add/remove/reorder questions (not fixed at 10) and add a `topic` field per question (see 5.1a for how `topic` should behave in both entry methods).
- Teacher sets **Title** and **Timer (minutes)** for the test on this same screen.
- Save as `draft` first; a separate **"Publish"** button moves it to `published` and makes it the current test available to the participant. Publishing a new test does **not** delete old tests — it just marks any previous `active`/`published` test as `archived`.

#### 5.1a Topic Field — Recommended Behavior
**Use a searchable dropdown ("combobox") pre-filled with previously used topics, but allow typing a new one on the fly.** This is the best middle ground for Deepak's analytics:
- Pure free-text tends to drift (`"Math"`, `"math"`, `"Maths"`, `"General Math"` all end up as separate buckets), which quietly breaks the topic-accuracy chart over time.
- A fully locked dropdown is too rigid for a fast-moving CSV upload workflow — the teacher shouldn't have to pre-register a topic before using it.
- The combobox gets both: existing topics stay clean and reusable (populate the list from `GET /api/analytics/history` or a lightweight `GET /api/topics`), and a genuinely new topic can still be added inline, which then becomes selectable next time.
- On CSV upload, if a `topic` value doesn't case-insensitively match an existing topic, treat it as a new topic rather than silently normalizing/merging it — surface it in the CSV preview screen (section 5.1) as "new topic: X" so the teacher notices typos before publishing, rather than after the analytics are already muddied.

### 5.2 Participant: Attempt a Test
- Landing page (`index.html`) checks for a test in `published` or `active` status.
  - No such test → show a friendly "No test available right now" state instead of blank/broken UI.
- On start, test moves to `active`, a `Submission` record is created with `startedAt`.
- Timer, lock-in, optimistic UI, red-warning-under-5-min — all existing behavior carries over unchanged, just now reading `timerMinutes` from the `Test` object instead of a hardcoded 15.
- On submit (manual or auto via time's up): compute score, set `submittedAt`, `timeTakenSeconds`, mark `Test.status = completed`.
- Show an **immediate results screen** to Deepak after submission: score, correct/wrong per question, time taken — no need to wait for the teacher.

### 5.3 Teacher: Live Tracker (current test)
- Same as today's admin tracker, generalized: score banner, per-question status (`Not answered yet` / `✅ Correct` / `❌ Wrong` with the picked option), but now scoped to whichever test is currently `active`/`completed` rather than a hardcoded single quiz.

### 5.4 Analytics Dashboard (new)
A new page/tab, e.g. `admin.html#analytics` or a separate `analytics.html`, viewable by both teacher and Deepak (same admin password gate is fine).

**Current test panel:**
- Live status as in 5.3, plus time-taken-so-far and time remaining.

**Historical panel:**
- **Score trend over time**: line/bar chart, one point per completed test (date vs. score%). Use Chart.js (lightweight, CDN-friendly, no build step).
- **Topic/weak-area breakdown**: accuracy % grouped by `topic` across all tests, sorted worst-first, so Deepak can see "Geography 40%, Math 90%" etc.
- **Time analysis**: average time per question overall, and flag questions/topics where time-taken was unusually high (possible sign of difficulty).
- **Test history table**: list of all past tests with title, date, score, time taken, and a link to view that test's detailed breakdown (question-by-question).

---

## 6. API Changes

| Endpoint | Change |
|---|---|
| `GET /api/tests/current` | Replaces `GET /api/questions`. Returns whichever test is `published`/`active`, or `null`. |
| `POST /api/tests` | Create a new test (draft), body = `{ title, timerMinutes, questions }`. Requires admin password. |
| `PUT /api/tests/:id` | Edit a draft test (questions/options/correct answer/timer). Requires admin password. |
| `POST /api/tests/:id/publish` | Publish a test; archives any currently published/active test. Requires admin password. |
| `POST /api/tests/upload-csv` | Accepts CSV file/text, parses + validates, returns parsed questions for preview (does not save yet). |
| `POST /api/submissions` | Start a submission for the current active test (called when Deepak begins). |
| `POST /api/submissions/:testId/answer` | Replaces `POST /api/answer`. Records one answer, checks correctness server-side. |
| `POST /api/submissions/:testId/submit` | Finalizes a submission — sets `submittedAt`, computes final score. |
| `GET /api/analytics/history` | Returns all completed tests + submissions, aggregated for the dashboard (score trend, topic accuracy, time stats). |
| `GET /api/topics` | Returns the distinct list of topics used so far, to populate the topic combobox (section 5.1a). |

Keep the existing `admin123` password check middleware; apply it to all `/api/tests/*` write routes.

---

## 7. Non-Functional Requirements
- No new hosting/infra — keep running via `start-poll.bat` + `localtunnel`, same as today.
- File-based storage remains human-inspectable (`db/tests.json`, `db/submissions.json`) for easy debugging.
- CSV parsing errors must never crash the server — always return a clear per-row error list.
- Keep all existing UI behaviors (red timer warning, lock-in on select, optimistic UI with revert-on-failure) intact — this PRD only extends, doesn't remove, that logic.

---

## 8. Leaving Room to Grow (not building now, just don't block it)
- `Submission` is modeled as one-per-test rather than embedding participant identity purely because there's one participant today. If multi-student support is ever added, add a `participantId` field to `Submission` — the rest of the schema already supports it.
- Keep `topic` on questions from day one even though analytics-by-topic is the only consumer right now — retrofitting it onto old data later is painful.

---

## 9. Suggested Build Order (for the AI assistant / Cursor)
1. Data layer: introduce `Test` + `Submission` models, migrate existing single-quiz data.json into the new shape (one seed test).
2. Backend routes per section 6.
3. Admin: Create Test screen (manual form first, then CSV upload + preview).
4. Admin: generalize timer + publish/archive flow.
5. Participant: point at `current test` API, use `timerMinutes` dynamically, add results screen post-submit.
6. Analytics dashboard: current-test panel first (low risk, reuses existing tracker logic), then historical panel with Chart.js.
7. Manual smoke test: create 2-3 tests via CSV, attempt each, confirm history and analytics populate correctly.

---

## 10. Decisions (resolved)
- **CSV headers**: fully forgiving — case-insensitive and order-insensitive, normalized on parse.
- **Question count**: no cap, fully flexible per test.
- **Topic field**: searchable combobox seeded from previously used topics, with inline "add new" support — see section 5.1a for the full reasoning and how new topics surface during CSV preview.
