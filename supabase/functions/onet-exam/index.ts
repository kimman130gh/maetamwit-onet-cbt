import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'jsr:@supabase/supabase-js@2/cors';

interface ServedChoiceSlot {
  slot: number;
  orig_choice: number;
  text: string;
}

interface ServedQuestion {
  id: string;
  indicator: string;
  question_text: string;
  choices: ServedChoiceSlot[];
}

const STUDENT_EMAIL_REGEX = /^mt(\d{5})@maetamwit\.ac\.th$/i;

function validateStudentAuth(
  emailRaw: string,
  passwordRaw: string
): { valid: true; studentCode: string; normalizedEmail: string } | { valid: false; message: string } {
  const email = String(emailRaw || '').trim();
  const match = email.match(STUDENT_EMAIL_REGEX);
  if (!match) {
    return {
      valid: false,
      message: 'รูปแบบอีเมลโรงเรียนไม่ถูกต้อง (ต้องเป็น mt00000@maetamwit.ac.th)',
    };
  }
  const digits = match[1];
  const expectedPassword = `Mtwit${digits}`;
  if (String(passwordRaw || '').trim() !== expectedPassword) {
    return {
      valid: false,
      message: 'รหัสผ่านนักเรียนไม่ถูกต้อง (รูปแบบ: Mtwit ตามด้วยเลขประจำตัว 5 หลัก)',
    };
  }
  return {
    valid: true,
    studentCode: digits,
    normalizedEmail: `mt${digits}@maetamwit.ac.th`,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function roomAllowed(approvedRooms: string[] | null, studentRoom: string): boolean {
  if (!approvedRooms || approvedRooms.length === 0) return true;
  if (approvedRooms.includes('ทั้งหมด') || approvedRooms.includes('ALL')) return true;
  if (!studentRoom) return false;
  return approvedRooms.some((r) => r.trim() === studentRoom.trim());
}

function getEffectiveMaxAttempts(exam: { max_attempts?: number | null; allow_retake?: boolean | null }): number {
  if (typeof exam.max_attempts === 'number' && Number.isFinite(exam.max_attempts) && exam.max_attempts >= 0) {
    return Math.trunc(exam.max_attempts);
  }
  return exam.allow_retake ? 0 : 1;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const secretKey =
      Deno.env.get('SUPABASE_SECRET_KEY') ??
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      '';

    if (!supabaseUrl || !secretKey) {
      return jsonResponse({ success: false, message: 'Server missing Supabase credentials' }, 500);
    }

    const adminDb = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action || 'lobby');

    // =========================================================================
    // ACTION 1: LOBBY (ดึงเฉพาะชุดข้อสอบที่ครูอนุมัติ approved = true)
    // =========================================================================
    if (action === 'lobby') {
      const gradeFilter = String(payload.grade || '').trim();
      const studentCode = String(payload.studentCode || '').trim();
      const studentName = String(payload.studentName || '').trim();
      const studentRoom = String(payload.studentRoom || '').trim();

      let query = adminDb
        .from('exams')
        .select('id, grade, category, order_no, title, indicators, question_count, time_limit_min, random_questions, random_choices, allow_retake, max_attempts, show_review, has_pin, approved, approved_rooms, updated_at')
        .eq('approved', true)
        .order('order_no', { ascending: true });

      if (gradeFilter && gradeFilter !== 'ALL') {
        query = query.eq('grade', gradeFilter);
      }

      const { data: exams, error: exErr } = await query;
      if (exErr) return jsonResponse({ success: false, message: exErr.message }, 400);

      const visibleExams = (exams || []).filter((ex) =>
        studentRoom ? roomAllowed(ex.approved_rooms, studentRoom) : true
      );

      // ตรวจสอบจำนวนครั้งที่ทำแล้วและผลล่าสุดจากรหัสนักเรียน 5 หลัก (หรือชื่อ+ห้อง)
      const submittedMap: Record<string, { score: number; max_score: number; percentage: number }> = {};
      const attemptCountMap: Record<string, number> = {};
      if ((studentCode || (studentName && studentRoom)) && visibleExams.length > 0) {
        let sQuery = adminDb
          .from('scores')
          .select('exam_id, score, max_score, percentage')
          .in('exam_id', visibleExams.map((e) => e.id))
          .order('submitted_at', { ascending: false });

        if (studentCode) {
          sQuery = sQuery.eq('student_code', studentCode);
        } else {
          sQuery = sQuery.eq('student_name', studentName).eq('student_room', studentRoom);
        }

        const { data: scoreRows } = await sQuery;
        for (const row of scoreRows || []) {
          attemptCountMap[row.exam_id] = (attemptCountMap[row.exam_id] || 0) + 1;
          if (!submittedMap[row.exam_id]) {
            submittedMap[row.exam_id] = {
              score: row.score,
              max_score: row.max_score,
              percentage: Number(row.percentage),
            };
          }
        }
      }

      const enriched = visibleExams.map((ex) => {
        const maxAttempts = getEffectiveMaxAttempts(ex);
        const attemptsUsed = attemptCountMap[ex.id] || 0;
        const attemptsRemaining = maxAttempts === 0 ? null : Math.max(0, maxAttempts - attemptsUsed);
        const limitReached = maxAttempts > 0 && attemptsUsed >= maxAttempts;
        return {
          ...ex,
          max_attempts: maxAttempts,
          attempts_used: attemptsUsed,
          attempts_remaining: attemptsRemaining,
          limit_reached: limitReached,
          already_submitted: attemptsUsed > 0,
          previous_result: submittedMap[ex.id] || null,
        };
      });

      return jsonResponse({ success: true, approvedExams: enriched });
    }

    // =========================================================================
    // ACTION 2: START (ตรวจรูปแบบอีเมล/รหัสผ่านนักเรียน + Back-End Approval Lock)
    // =========================================================================
    if (action === 'start') {
      const authRes = validateStudentAuth(payload.studentEmail, payload.studentPassword);
      if (!authRes.valid) {
        return jsonResponse({ success: false, message: authRes.message }, 401);
      }

      const examId = String(payload.examId || '').trim();
      const studentCode = authRes.studentCode;
      const studentName = String(payload.studentName || '').trim() || authRes.normalizedEmail;
      const studentRoom = String(payload.studentRoom || '').trim();
      const pinInput = String(payload.pin || '').trim();

      if (!examId || !studentRoom) {
        return jsonResponse({ success: false, message: 'กรุณาเลือกห้องเรียนและชุดข้อสอบให้ครบถ้วน' }, 400);
      }

      const { data: exam, error: eErr } = await adminDb
        .from('exams')
        .select('*')
        .eq('id', examId)
        .single();

      if (eErr || !exam) {
        return jsonResponse({ success: false, message: 'ไม่พบชุดข้อสอบที่ระบุ' }, 404);
      }
      if (exam.approved !== true) {
        return jsonResponse({
          success: false,
          message: 'ข้อสอบชุดนี้ยังไม่ได้รับการอนุมัติเปิดสอบจากครูผู้สอน (Locked by Back-End)',
        }, 403);
      }
      if (!roomAllowed(exam.approved_rooms, studentRoom)) {
        return jsonResponse({
          success: false,
          message: `ชุดข้อสอบนี้เปิดอนุมัติเฉพาะห้อง ${exam.approved_rooms.join(', ')} เท่านั้น`,
        }, 403);
      }

      const { data: secretRow } = await adminDb
        .from('exam_secrets')
        .select('require_pin')
        .eq('exam_id', examId)
        .maybeSingle();

      const expectedPin = String(secretRow?.require_pin || '').trim();
      if (expectedPin && pinInput !== expectedPin) {
        return jsonResponse({
          success: false,
          message: 'รหัส PIN เข้าห้องสอบไม่ถูกต้อง กรุณาสอบถามครูผู้สอน',
        }, 403);
      }

      // ตรวจสอบโควตาจำนวนครั้งที่ทำได้ (max_attempts: 1=ครั้งเดียว, N=ทำได้ N ครั้ง, 0=ไม่จำกัด)
      const maxAttempts = getEffectiveMaxAttempts(exam);
      if (maxAttempts > 0) {
        const { data: existingScores, count: attemptsUsed } = await adminDb
          .from('scores')
          .select('id, score, max_score', { count: 'exact' })
          .eq('exam_id', examId)
          .eq('student_code', studentCode)
          .order('submitted_at', { ascending: false })
          .limit(1);

        const usedCount = Number(attemptsUsed || 0);
        if (usedCount >= maxAttempts) {
          const latest = existingScores?.[0];
          const retakeCap = Math.max(0, maxAttempts - 1);
          return jsonResponse({
            success: false,
            message:
              maxAttempts === 1
                ? `รหัสนักเรียน ${studentCode} ส่งข้อสอบชุดนี้ไปแล้ว (${latest ? `${latest.score}/${latest.max_score}` : '1 ครั้ง'}) และไม่อนุญาตให้ทดสอบซ้ำ`
                : `รหัสนักเรียน ${studentCode} ทดสอบครบจำนวนที่กำหนดแล้ว (${usedCount}/${maxAttempts} ครั้ง • สอบซ้ำได้สูงสุด ${retakeCap} ครั้ง)`,
          }, 403);
        }
      }

      const { data: itemRows, error: qErr } = await adminDb
        .from('exam_items')
        .select('item_order, questions(id, indicator, question_text, choice_1, choice_2, choice_3, choice_4)')
        .eq('exam_id', examId)
        .order('item_order', { ascending: true });

      if (qErr || !itemRows || itemRows.length === 0) {
        return jsonResponse({ success: false, message: 'ยังไม่มีโจทย์ข้อสอบในชุดนี้' }, 404);
      }

      let qPool = itemRows
        .map((r: any) => r.questions)
        .filter(Boolean);

      if (exam.random_questions) {
        qPool = shuffleArray(qPool);
      }
      if (exam.question_count > 0 && exam.question_count < qPool.length) {
        qPool = qPool.slice(0, exam.question_count);
      }

      const servedQuestions: ServedQuestion[] = qPool.map((q: any) => {
        const baseChoices: ServedChoiceSlot[] = [
          { slot: 1, orig_choice: 1, text: q.choice_1 },
          { slot: 2, orig_choice: 2, text: q.choice_2 },
          { slot: 3, orig_choice: 3, text: q.choice_3 },
          { slot: 4, orig_choice: 4, text: q.choice_4 },
        ];
        const ordered = exam.random_choices ? shuffleArray(baseChoices) : baseChoices;
        const renumbered = ordered.map((c, idx) => ({ ...c, slot: idx + 1 }));
        return {
          id: q.id,
          indicator: q.indicator,
          question_text: q.question_text,
          choices: renumbered,
        };
      });

      const expiresAt = new Date(Date.now() + (exam.time_limit_min + 2) * 60_000).toISOString();
      const { data: sessionRow, error: sErr } = await adminDb
        .from('exam_sessions')
        .insert({
          exam_id: exam.id,
          grade: exam.grade,
          student_code: studentCode,
          student_name: studentName,
          student_room: studentRoom,
          served_questions: servedQuestions,
          status: 'in_progress',
          expires_at: expiresAt,
        })
        .select('id')
        .single();

      if (sErr || !sessionRow) {
        return jsonResponse({ success: false, message: sErr?.message || 'สร้างเซสชันสอบไม่สำเร็จ' }, 500);
      }

      const sanitizedQuestions = servedQuestions.map((sq) => ({
        id: sq.id,
        indicator: sq.indicator,
        question: sq.question_text,
        choices: sq.choices.map((c) => ({ slot: c.slot, text: c.text })),
      }));

      return jsonResponse({
        success: true,
        sessionId: sessionRow.id,
        examMeta: {
          id: exam.id,
          grade: exam.grade,
          category: exam.category,
          title: exam.title,
          indicators: exam.indicators,
          time_limit_min: exam.time_limit_min,
          show_review: exam.show_review,
          question_count: sanitizedQuestions.length,
        },
        questions: sanitizedQuestions,
      });
    }

    // =========================================================================
    // ACTION 3: SUBMIT (ตรวจคำตอบจาก question_keys บน Server เท่านั้น!)
    // =========================================================================
    if (action === 'submit') {
      const sessionId = String(payload.sessionId || '').trim();
      const answers = (payload.answers || {}) as Record<string, number>;
      const timeSpentSec = Math.max(0, Number(payload.timeSpentSec) || 0);

      if (!sessionId) {
        return jsonResponse({ success: false, message: 'ไม่พบรหัสเซสชันการสอบ' }, 400);
      }

      const { data: session, error: sessErr } = await adminDb
        .from('exam_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessErr || !session) {
        return jsonResponse({ success: false, message: 'ไม่พบข้อมูลเซสชันการสอบ' }, 404);
      }
      if (session.status !== 'in_progress') {
        return jsonResponse({ success: false, message: 'เซสชันการสอบนี้ถูกส่งคำตอบไปแล้ว' }, 409);
      }

      const { data: exam } = await adminDb
        .from('exams')
        .select('id, title, show_review, allow_retake, max_attempts')
        .eq('id', session.exam_id)
        .single();

      // ตรวจซ้ำก่อนบันทึกคะแนน ป้องกันกรณีเปิดหลายแท็บเกินโควตาสอบซ้ำ
      if (exam) {
        const submitMaxAttempts = getEffectiveMaxAttempts(exam);
        if (submitMaxAttempts > 0) {
          const { count: currentSubmits } = await adminDb
            .from('scores')
            .select('id', { count: 'exact', head: true })
            .eq('exam_id', session.exam_id)
            .eq('student_code', session.student_code);

          const submittedCnt = Number(currentSubmits || 0);
          if (submittedCnt >= submitMaxAttempts) {
            await adminDb
              .from('exam_sessions')
              .update({ status: 'expired', submitted_at: new Date().toISOString() })
              .eq('id', session.id);
            return jsonResponse({
              success: false,
              message: `ส่งคำตอบไม่ได้: รหัสนักเรียน ${session.student_code} ทดสอบครบจำนวนสูงสุด ${submitMaxAttempts} ครั้งแล้ว`,
            }, 403);
          }
        }
      }

      const served: ServedQuestion[] = Array.isArray(session.served_questions)
        ? session.served_questions
        : [];
      const qIds = served.map((s) => s.id);

      const { data: keysRows, error: kErr } = await adminDb
        .from('question_keys')
        .select('question_id, correct_choice, explanation')
        .in('question_id', qIds);

      if (kErr || !keysRows) {
        return jsonResponse({ success: false, message: 'ไม่สามารถโหลดฐานเฉลยได้' }, 500);
      }

      const keyMap: Record<string, { correct_choice: number; explanation: string }> = {};
      for (const k of keysRows) {
        keyMap[k.question_id] = k;
      }

      let score = 0;
      const maxScore = served.length;
      const breakdown: Record<string, { correct: number; total: number; percentage: number }> = {};
      const reviewData: any[] = [];

      for (const sq of served) {
        const keyInfo = keyMap[sq.id];
        if (!keyInfo) continue;

        const pickedSlot = Number(answers[sq.id] || 0);
        const pickedObj = sq.choices.find((c) => c.slot === pickedSlot);
        const correctObj = sq.choices.find((c) => c.orig_choice === keyInfo.correct_choice);
        const isCorrect = Boolean(pickedObj && pickedObj.orig_choice === keyInfo.correct_choice);

        if (isCorrect) score++;

        const ind = sq.indicator || 'พื้นฐาน';
        if (!breakdown[ind]) breakdown[ind] = { correct: 0, total: 0, percentage: 0 };
        breakdown[ind].total++;
        if (isCorrect) breakdown[ind].correct++;

        if (exam?.show_review) {
          reviewData.push({
            id: sq.id,
            indicator: ind,
            question: sq.question_text,
            studentChoice: pickedObj ? pickedObj.text : 'ไม่ได้ตอบ',
            correctChoice: correctObj ? correctObj.text : '',
            isCorrect,
            explanation: keyInfo.explanation,
          });
        }
      }

      for (const ind of Object.keys(breakdown)) {
        const b = breakdown[ind];
        b.percentage = b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0;
      }

      const percentage = maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(2)) : 0;

      await adminDb
        .from('exam_sessions')
        .update({ status: 'submitted', submitted_at: new Date().toISOString() })
        .eq('id', session.id);

      const { error: insErr } = await adminDb.from('scores').insert({
        session_id: session.id,
        exam_id: session.exam_id,
        grade: session.grade,
        student_code: session.student_code,
        student_name: session.student_name,
        student_room: session.student_room,
        score,
        max_score: maxScore,
        percentage,
        time_spent_sec: timeSpentSec,
        indicator_breakdown: breakdown,
        answers_json: answers,
      });

      if (insErr) {
        return jsonResponse({ success: false, message: 'บันทึกผลคะแนนผิดพลาด: ' + insErr.message }, 500);
      }

      return jsonResponse({
        success: true,
        exam_id: session.exam_id,
        exam_title: exam?.title || session.exam_id,
        score,
        maxScore,
        percentage,
        breakdown,
        showReview: Boolean(exam?.show_review),
        reviewData,
      });
    }

    return jsonResponse({ success: false, message: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    return jsonResponse({ success: false, message: err?.message || 'Internal error' }, 500);
  }
});
