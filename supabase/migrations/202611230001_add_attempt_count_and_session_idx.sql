-- เพิ่มคอลัมน์ attempt_count เพื่อบันทึกจำนวนครั้งที่นักเรียนส่งสอบในชุดนั้น และดัชนีช่วยนับรอบส่งจาก exam_sessions
ALTER TABLE public.scores
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_exam_sessions_exam_student_status
  ON public.exam_sessions(exam_id, student_code, status);
