-- Covering index for foreign key public.exam_items(question_id)
CREATE INDEX IF NOT EXISTS idx_exam_items_qid ON public.exam_items(question_id);
