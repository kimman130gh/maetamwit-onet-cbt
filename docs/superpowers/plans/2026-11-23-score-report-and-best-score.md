# Score Report, Gender/ID Sorting, CSV Export & Best-Score Retake Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce 1 best-score record per `(exam_id, student_code)` preserving the first-attempt name, and upgrade the Admin Score Report tab to select grade + exam, view whole-grade scores sorted by Male -> Female -> Student ID (joined with `public.students`), and export UTF-8 BOM CSV.

**Architecture:**
1. Edge Function (`onet-exam`) + PostgreSQL migration count attempts from `exam_sessions (status = 'submitted')`, deduplicate `public.scores` by `(exam_id, student_code)` keeping the earliest `student_name`/`student_room` and highest score, and enforce `UNIQUE (exam_id, student_code)`. Deploy Edge Function before applying the unique constraint migration so active student sessions (`in_progress`) experience zero downtime.
2. Extract pure report-building, gender/grade normalization, sorting (`ชาย -> หญิง -> รหัสนักเรียน`), Gain Score grouping by `student_code`, and CSV serialization into `src/lib/scoreReport.ts` with `node --test` unit tests in `tests/`.
3. Update `src/pages/AdminBackend.tsx` Tab 2 and `src/pages/StudentPortal.tsx` result/lobby copy to match best-score behavior.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6, Supabase PostgreSQL + Deno Edge Functions, Node 24 native test runner (`node --test`).

## Global Constraints
- Preserve `student_name`, `student_room`, and `grade` from the student's **first** recorded attempt for `(exam_id, student_code)`.
- On retake submission (`submit`), locate existing record by `(exam_id, student_code)`: update score/answers/time/session_id only when `newScore > existing.score`; if `newScore <= existing.score`, keep existing score/answers/timestamp unchanged while incrementing `attempt_count`.
- `max_attempts` enforcement in `lobby`, `start`, and `submit` must count `exam_sessions` where `status = 'submitted'` (not `scores` row count).
- Score report sorting default: Male (`ชาย`: `ด.ช.`/`เด็กชาย`/`นาย`) -> Female (`หญิง`: `ด.ญ.`/`เด็กหญิง`/`น.ส.`/`นางสาว`/`นาง`) -> Other, then Student ID ascending (`numeric: true`).
- CSV export must include UTF-8 BOM (`\uFEFF`) for Windows Excel Thai compatibility.
- Do NOT auto-alter RLS on `public.students` (shared table with other school apps); ensure `AdminBackend` degrades gracefully if `students` is empty/restricted.

## Review Focus
- Retake with different `student_name` or wrong `student_room` does not create a duplicate `scores` row or overwrite first-attempt identity.
- Retake with lower or equal score preserves existing best score/timestamp while still decrementing remaining attempts (`max_attempts`) and showing current attempt feedback to the student.
- Students who omitted `ด.ช.`/`ด.ญ.` in `scores.student_name` still sort accurately by gender via `public.students.title_prefix` lookup.
- Unsubmitted students in the selected grade appear when roster mode is enabled, and out-of-roster/cross-grade submitters (e.g. test IDs) are not silently dropped.
- Pagination when loading `scores` (>1,000 rows PostgREST limit) ensures no missing scores in large classes/terms.

---

### Task 1: Pure Best-Score Decision Helper + Edge Function Retake Update

**Files:**
- Create: `supabase/functions/onet-exam/scoreUpsert.ts`
- Modify: `supabase/functions/onet-exam/index.ts`
- Modify: `package.json` (add `"test"` script)
- Test: `tests/scoreUpsert.test.ts`

**Interfaces:**
- Produces `decideScoreWrite(existingRows: ExistingScoreRecord[], incoming: IncomingScoreInput): ScoreWriteDecision`

- [ ] **Step 1: Write failing tests in `tests/scoreUpsert.test.ts`**
  Cover: first submission (`create`), retake higher score (`update_higher` keeping first `student_name`/`student_room`), retake lower score (`keep_existing` updating only `attempt_count`), retake equal score (`keep_existing`), and pre-migration multi-row cleanup (`dedupeIds`).
- [ ] **Step 2: Run `node --test tests/scoreUpsert.test.ts` to verify FAIL**
- [ ] **Step 3: Implement `supabase/functions/onet-exam/scoreUpsert.ts`**
- [ ] **Step 4: Run `node --test tests/scoreUpsert.test.ts` to verify PASS**
- [ ] **Step 5: Update `supabase/functions/onet-exam/index.ts`**
  - `lobby`: count `attempts_used` from `exam_sessions` (`status = 'submitted'`), fetch `previous_result` from `scores`.
  - `start`: count `usedCount` from `exam_sessions` (`status = 'submitted'`).
  - `submit`: check `maxAttempts` from `exam_sessions`, mark session `submitted`, call `decideScoreWrite` against existing `scores` rows for `(exam_id, student_code)`, apply insert/update/cleanup, and return `scoreAction`, `bestScore`, `bestMaxScore`, `bestPercentage`, `attemptsUsed`.

### Task 2: Deploy Edge Function & Apply Database Migration

**Files:**
- Create: `supabase/migrations/202611230001_scores_unique_best_and_attempts.sql`

- [ ] **Step 1: Deploy updated `onet-exam` (`index.ts` + `scoreUpsert.ts`) via Supabase MCP `deploy_edge_function` (`verify_jwt: false`)**
- [ ] **Step 2: Write `supabase/migrations/202611230001_scores_unique_best_and_attempts.sql`**
  - Add `attempt_count integer NOT NULL DEFAULT 1` to `public.scores`.
  - Deduplicate existing `(exam_id, student_code)` groups: preserve earliest row's `student_name`/`student_room`/`grade`, keep highest `score` (tie-break earliest `submitted_at`), set `attempt_count = group_count`, delete non-kept rows.
  - Add `CONSTRAINT uq_scores_exam_student UNIQUE (exam_id, student_code)` and `idx_exam_sessions_exam_student_status`.
- [ ] **Step 3: Apply migration via Supabase MCP `apply_migration` and verify with `execute_sql` that 0 duplicates remain and `attempt_count` matches `exam_sessions` `submitted` counts**

### Task 3: Score Report Builder, Gender/ID Sorting, Gain Score & CSV Export

**Files:**
- Modify: `src/types.ts` (add `StudentRosterRow`, `ClassReportRow`, optional `attempt_count` on `ScoreRow`, optional `scoreAction`/`bestScore` fields on `ExamResultPayload`)
- Create: `src/lib/scoreReport.ts`
- Test: `tests/scoreReport.test.ts`

**Interfaces:**
- Produces `extractGradeFromText`, `extractRoomFromStudent`, `detectGender`, `buildClassScoreReport`, `buildGainScoreRows`, `buildScoreReportCsv`, `buildReportCsvFilename`

- [ ] **Step 1: Write failing tests in `tests/scoreReport.test.ts`**
  Cover: gender detection (`ด.ช.`, `ด.ญ.`, `นาย`, `น.ส.`, fallback from `enteredName`, unknown), sorting (`ชาย -> หญิง -> ไม่ระบุ`, numeric/zero-padded `student_code`), room filtering (`ALL` vs `ม.1/2`), `includeUnsubmitted` true/false, cross-grade/non-roster submitters preserved, Gain Score keyed by `student_code` + sorted `ชาย -> หญิง -> รหัส`, and CSV export with UTF-8 BOM + quoting + formula-injection neutralization.
- [ ] **Step 2: Run `node --test tests/scoreReport.test.ts` to verify FAIL**
- [ ] **Step 3: Update `src/types.ts` and implement `src/lib/scoreReport.ts`**
- [ ] **Step 4: Run `node --test tests/scoreReport.test.ts` to verify PASS**

### Task 4: Update AdminBackend Tab 2 & StudentPortal Messaging

**Files:**
- Modify: `src/pages/AdminBackend.tsx`
- Modify: `src/pages/StudentPortal.tsx`

- [ ] **Step 1: Update `AdminBackend.tsx`**
  - Paginate `scores` loading (chunks of 1,000 via `.range()`) + load active `public.students` roster (graceful fallback if empty/blocked).
  - Replace Tab 2 score section with **รายงานผลคะแนนรายแบบทดสอบ (ทั้งระดับชั้น)**: selectors for `reportGrade` (`ม.1`/`ม.2`/`ม.3`), `reportExamId`, `reportRoom` (dynamic from roster + scores), toggle `แสดงรายชื่อที่ยังไม่สอบด้วย`, toggle `แยกกลุ่มตามห้องเรียน`, summary stats bar, sorted report table (`ชาย -> หญิง -> รหัสนักเรียน`), and `Export CSV` button.
  - Upgrade Gain Score table below to filter by `reportGrade`/`reportRoom`, key by `student_code`, enrich gender/name from `students`, and sort `ชาย -> หญิง -> รหัส -> แผนที่`.
- [ ] **Step 2: Update `StudentPortal.tsx`**
  - Lobby badge: show `"คะแนนสูงสุดที่บันทึก:"` for `previous_result`.
  - Result screen: reflect `scoreAction` (`created` / `updated_higher` / `kept_higher`) clearly.

### Task 5: Full Verification

- [ ] **Step 1: Run `npm test` (`node --test tests/*.test.ts`)**
- [ ] **Step 2: Run `npm run build` (`tsc -b && vite build`)**
- [ ] **Step 3: Verify Edge Function logs/status and DB state via Supabase MCP**
