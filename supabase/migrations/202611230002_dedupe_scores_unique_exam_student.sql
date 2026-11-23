-- ยุบรวมผลคะแนนที่ซ้ำกันใน public.scores โดยยึด (exam_id, student_code):
-- 1) คง student_name, student_room, grade จากการส่งครั้งแรกสุด
-- 2) คง score, max_score, percentage, answers_json, indicator_breakdown, session_id จากรอบที่คะแนนสูงสุด (หากเท่ากันใช้รอบแรกสุดที่ทำได้)
-- 3) บันทึก attempt_count จากจำนวนการส่งจริงใน exam_sessions
-- 4) เพิ่ม Unique Constraint (exam_id, student_code) ป้องกันข้อมูลซ้ำถาวร
WITH first_identity AS (
  SELECT DISTINCT ON (exam_id, student_code)
    exam_id,
    student_code,
    grade AS first_grade,
    student_name AS first_name,
    student_room AS first_room
  FROM public.scores
  ORDER BY exam_id, student_code, submitted_at ASC, id ASC
),
best_row AS (
  SELECT DISTINCT ON (exam_id, student_code)
    id AS keep_id,
    exam_id,
    student_code
  FROM public.scores
  ORDER BY exam_id, student_code, score DESC, submitted_at ASC, id ASC
),
session_counts AS (
  SELECT
    exam_id,
    student_code,
    COUNT(*)::integer AS submitted_attempts
  FROM public.exam_sessions
  WHERE status = 'submitted'
  GROUP BY exam_id, student_code
),
score_counts AS (
  SELECT
    exam_id,
    student_code,
    COUNT(*)::integer AS score_rows
  FROM public.scores
  GROUP BY exam_id, student_code
),
deleted AS (
  DELETE FROM public.scores sc
  USING best_row br
  WHERE sc.exam_id = br.exam_id
    AND sc.student_code = br.student_code
    AND sc.id <> br.keep_id
  RETURNING sc.id
)
UPDATE public.scores sc
SET
  grade = fi.first_grade,
  student_name = fi.first_name,
  student_room = fi.first_room,
  attempt_count = GREATEST(COALESCE(cnt.submitted_attempts, 0), COALESCE(scnt.score_rows, 1), 1)
FROM best_row br
JOIN first_identity fi
  ON fi.exam_id = br.exam_id AND fi.student_code = br.student_code
LEFT JOIN session_counts cnt
  ON cnt.exam_id = br.exam_id AND cnt.student_code = br.student_code
LEFT JOIN score_counts scnt
  ON scnt.exam_id = br.exam_id AND scnt.student_code = br.student_code
WHERE sc.id = br.keep_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_scores_exam_student'
      AND conrelid = 'public.scores'::regclass
  ) THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT uq_scores_exam_student UNIQUE (exam_id, student_code);
  END IF;
END $$;
