-- =========================================================================
-- 202611110001_init_onet_schema.sql
-- 3. (ม.1 - ม.3 คลัง 1,080 ข้อ) + ระบบอนุมัติหลังบ้าน (Back-End)
-- ปฏิบัติตามมาตรฐานความปลอดภัย Supabase 2026:
--   1) Explicit GRANT / REVOKE แนบคู่ RLS ทุกตาราง
--   2) แยก question_keys & exam_secrets ออกจากสิทธิ์ anon 100%
--   3) ตรวจสิทธิ์ครูผู้สอนผ่านตาราง public.teacher_admins (ไม่ใช้ user_metadata)
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. ตารางครูผู้ดูแลระบบหลังบ้าน (เชื่อมกับ Supabase Auth Users)
CREATE TABLE IF NOT EXISTS public.teacher_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT 'ครูผู้สอน',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. ตารางรายการชุดข้อสอบทั้งหมด (Pre-test / Post-test / ท้ายหน่วย / กลาง-ปลายภาค / รายตัวชี้วัด)
CREATE TABLE IF NOT EXISTS public.exams (
  id text PRIMARY KEY,
  grade text NOT NULL,
  category text NOT NULL,
  order_no integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  indicators text NOT NULL,
  question_count integer NOT NULL DEFAULT 10,
  time_limit_min integer NOT NULL DEFAULT 10,
  random_questions boolean NOT NULL DEFAULT false,
  random_choices boolean NOT NULL DEFAULT false,
  allow_retake boolean NOT NULL DEFAULT false,
  show_review boolean NOT NULL DEFAULT true,
  has_pin boolean NOT NULL DEFAULT false,
  approved boolean NOT NULL DEFAULT false,
  approved_rooms text[] NOT NULL DEFAULT ARRAY['ทั้งหมด'],
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. ตารางเก็บรหัส PIN ของชุดสอบแบบลับ (ไม่เปิดสิทธิ์ให้ anon อ่านเด็ดขาด)
CREATE TABLE IF NOT EXISTS public.exam_secrets (
  exam_id text PRIMARY KEY REFERENCES public.exams(id) ON DELETE CASCADE,
  require_pin text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger ซิงก์คอลัมน์ exams.has_pin อัตโนมัติโดยไม่เปิดเผยตัวเลข PIN
CREATE OR REPLACE FUNCTION public.sync_exam_has_pin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.exams
     SET has_pin = (char_length(btrim(NEW.require_pin)) > 0),
         updated_at = now()
   WHERE id = NEW.exam_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sync_exam_has_pin
AFTER INSERT OR UPDATE ON public.exam_secrets
FOR EACH ROW EXECUTE FUNCTION public.sync_exam_has_pin();

-- 4. ตารางคลังโจทย์ข้อสอบ (เฉพาะคำถาม + ตัวเลือก 1-4 ไม่มีเฉลยปนอยู่!)
CREATE TABLE IF NOT EXISTS public.questions (
  id text PRIMARY KEY,
  grade text NOT NULL,
  subject text NOT NULL,
  indicator text NOT NULL,
  unit text NOT NULL,
  question_text text NOT NULL,
  choice_1 text NOT NULL,
  choice_2 text NOT NULL,
  choice_3 text NOT NULL,
  choice_4 text NOT NULL,
  bloom_level text NOT NULL DEFAULT 'เข้าใจ',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_grade_ind ON public.questions(grade, indicator);

-- 5. ตารางเฉลยและคำอธิบายลับ (Server-side Grading & Teacher เท่านั้น)
CREATE TABLE IF NOT EXISTS public.question_keys (
  question_id text PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
  correct_choice smallint NOT NULL CHECK (correct_choice BETWEEN 1 AND 4),
  explanation text NOT NULL DEFAULT ''
);

-- 6. ตารางจับคู่ข้อสอบเข้าแต่ละชุดสอบ
CREATE TABLE IF NOT EXISTS public.exam_items (
  exam_id text NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  item_order integer NOT NULL DEFAULT 1,
  PRIMARY KEY (exam_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_items_exam ON public.exam_items(exam_id, item_order);

-- 7. ตารางเซสชันการสอบแบบเรียลไทม์ (ติดตามสถานะการสอบและเก็บตัวเลือกที่สลับไว้ตรวจฝั่ง Server)
CREATE TABLE IF NOT EXISTS public.exam_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id text NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  grade text NOT NULL DEFAULT 'ม.2',
  student_code text NOT NULL,
  student_name text NOT NULL,
  student_room text NOT NULL,
  served_questions jsonb NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_lookup ON public.exam_sessions(exam_id, student_room, status);

-- 8. ตารางผลคะแนนสอบ (บันทึกโดย Edge Function เท่านั้น ป้องกันการปลอมคะแนนจาก Browser)
CREATE TABLE IF NOT EXISTS public.scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid UNIQUE REFERENCES public.exam_sessions(id) ON DELETE SET NULL,
  exam_id text NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  grade text NOT NULL DEFAULT 'ม.2',
  student_code text NOT NULL,
  student_name text NOT NULL,
  student_room text NOT NULL,
  score integer NOT NULL CHECK (score >= 0),
  max_score integer NOT NULL CHECK (max_score > 0),
  percentage numeric(5,2) NOT NULL,
  time_spent_sec integer NOT NULL DEFAULT 0,
  indicator_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scores_exam_room ON public.scores(exam_id, student_room, submitted_at DESC);

-- =========================================================================
-- SECURITY: EXPLICIT GRANTS + ROW LEVEL SECURITY (RLS) ON EVERY TABLE
-- =========================================================================

ALTER TABLE public.teacher_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

-- ล้างสิทธิ์พื้นฐานทั้งหมดก่อน แล้วกำหนดตามหลัก Least Privilege
REVOKE ALL ON public.teacher_admins, public.exams, public.exam_secrets, public.questions, public.question_keys, public.exam_items, public.exam_sessions, public.scores FROM anon, authenticated, public;

-- สิทธิ์เต็มเฉพาะ Edge Functions / Backend (service_role)
GRANT ALL ON public.teacher_admins, public.exams, public.exam_secrets, public.questions, public.question_keys, public.exam_items, public.exam_sessions, public.scores TO service_role;

-- teacher_admins: ครูอ่านแถวของตนเองได้เพื่อยืนยันบทบาท
GRANT SELECT ON public.teacher_admins TO authenticated;
CREATE POLICY "teacher_read_own_admin_row"
  ON public.teacher_admins FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- exams: นักเรียน (anon) เห็นเฉพาะชุดที่ approved = true; ครู (authenticated teacher) เห็นและแก้ไขได้ทั้งหมด
GRANT SELECT ON public.exams TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.exams TO authenticated;

CREATE POLICY "student_view_approved_exams_only"
  ON public.exams FOR SELECT
  TO anon
  USING (approved = true);

CREATE POLICY "teacher_select_all_exams"
  ON public.exams FOR SELECT
  TO authenticated
  USING (
    approved = true
    OR EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid()))
  );

CREATE POLICY "teacher_insert_exams"
  ON public.exams FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

CREATE POLICY "teacher_update_exams"
  ON public.exams FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

CREATE POLICY "teacher_delete_exams"
  ON public.exams FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

-- exam_secrets: เฉพาะครูที่ล็อกอินเท่านั้น (นักเรียน anon ห้ามเข้าถึงโดยเด็ดขาด)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_secrets TO authenticated;
CREATE POLICY "teacher_manage_exam_secrets"
  ON public.exam_secrets FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

-- questions, question_keys, exam_items: นักเรียน anon อ่านตรงไม่ได้ (รับผ่าน Edge Function เมื่อสอบเท่านั้น)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions, public.question_keys, public.exam_items TO authenticated;

CREATE POLICY "teacher_manage_questions"
  ON public.questions FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

CREATE POLICY "teacher_manage_question_keys"
  ON public.question_keys FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

CREATE POLICY "teacher_manage_exam_items"
  ON public.exam_items FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

-- exam_sessions & scores: นักเรียนอ่าน/เขียนตรงไม่ได้ (ทำผ่าน Edge Function), ครูดูและลบประวัติทดสอบได้
GRANT SELECT, DELETE ON public.exam_sessions, public.scores TO authenticated;

CREATE POLICY "teacher_view_delete_sessions"
  ON public.exam_sessions FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

CREATE POLICY "teacher_delete_sessions"
  ON public.exam_sessions FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

CREATE POLICY "teacher_view_scores"
  ON public.scores FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

CREATE POLICY "teacher_delete_scores"
  ON public.scores FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teacher_admins ta WHERE ta.user_id = (select auth.uid())));

-- ปิดการมองเห็น schema Introspection ของ pg_graphql ต่อตารางลับหากเปิดใช้งานอยู่
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphql') THEN
    REVOKE ALL ON public.question_keys, public.exam_secrets FROM anon;
  END IF;
END $$;

-- เปิด Supabase Realtime สำหรับหน้า Lobby (exams) และ Live Monitor หลังบ้าน (exam_sessions, scores)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.exams; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.exam_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.scores; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
