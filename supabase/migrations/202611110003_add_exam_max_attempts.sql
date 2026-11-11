-- เพิ่มคอลัมน์ max_attempts เพื่อระบุจำนวนครั้งที่นักเรียนทดสอบได้แต่ละชุด (1 = สอบได้ 1 ครั้ง/ไม่ซ้ำ, 2+ = ทำซ้ำได้ max_attempts-1 ครั้ง, 0 = ไม่จำกัด)
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exams_max_attempts_nonneg'
      AND conrelid = 'public.exams'::regclass
  ) THEN
    ALTER TABLE public.exams
      ADD CONSTRAINT exams_max_attempts_nonneg CHECK (max_attempts >= 0);
  END IF;
END $$;

UPDATE public.exams
   SET max_attempts = 0
 WHERE allow_retake = true AND max_attempts = 1;
