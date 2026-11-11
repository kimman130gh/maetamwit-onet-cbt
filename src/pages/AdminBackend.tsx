import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  Download,
  Lock,
  LogOut,
  Radio,
  RefreshCw,
  Save,
  ShieldAlert,
  Unlock,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { ExamCatalogRow, ScoreRow, SessionMonitorRow } from '../types';

interface Props {
  onGoStudent: () => void;
}

interface QuestionBankRow {
  id: string;
  grade: string;
  subject: string;
  indicator: string;
  question_text: string;
  choice_1: string;
  choice_2: string;
  choice_3: string;
  choice_4: string;
  question_keys?: { correct_choice: number; explanation: string } | null;
}

const THAI_LETTERS = ['', 'ก', 'ข', 'ค', 'ง'];

export default function AdminBackend({ onGoStudent }: Props) {
  const [authChecked, setAuthChecked] = useState(false);
  const [teacherEmail, setTeacherEmail] = useState<string>('');
  const [isTeacherAdmin, setIsTeacherAdmin] = useState(false);

  // Login Form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Admin Dashboard Data
  const [activeTab, setActiveTab] = useState<'approvals' | 'scores' | 'bank'>('approvals');
  const [gradeFilter, setGradeFilter] = useState<string>('ม.2');
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [exams, setExams] = useState<ExamCatalogRow[]>([]);
  const [pinMap, setPinMap] = useState<Record<string, string>>({});
  const [attemptsDraft, setAttemptsDraft] = useState<Record<string, number>>({});
  const [customAttemptsMap, setCustomAttemptsMap] = useState<Record<string, boolean>>({});
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [activeSessions, setActiveSessions] = useState<SessionMonitorRow[]>([]);
  const [bankRows, setBankRows] = useState<QuestionBankRow[]>([]);
  const [bankGrade, setBankGrade] = useState('ม.2');
  const [roomFilter, setRoomFilter] = useState('ALL');
  const [busyId, setBusyId] = useState<string>('');

  const verifySession = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setAuthChecked(true);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setTeacherEmail('');
      setIsTeacherAdmin(false);
      setAuthChecked(true);
      return;
    }
    setTeacherEmail(session.user.email || '');
    const { data: adminRow } = await supabase
      .from('teacher_admins')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle();

    setIsTeacherAdmin(Boolean(adminRow));
    setAuthChecked(true);
  }, []);

  const loadAllAdminData = useCallback(async () => {
    if (!isTeacherAdmin) return;
    const [exRes, secRes, scRes, sessRes] = await Promise.all([
      supabase.from('exams').select('*').order('order_no', { ascending: true }),
      supabase.from('exam_secrets').select('exam_id, require_pin'),
      supabase.from('scores').select('*').order('submitted_at', { ascending: false }).limit(500),
      supabase
        .from('exam_sessions')
        .select('id, exam_id, grade, student_code, student_name, student_room, status, started_at')
        .eq('status', 'in_progress')
        .order('started_at', { ascending: false }),
    ]);

    if (exRes.data) {
      const exList = exRes.data as ExamCatalogRow[];
      setExams(exList);
      const nextDraft: Record<string, number> = {};
      const nextCustom: Record<string, boolean> = {};
      const presets = new Set([0, 1, 2, 3, 4, 5, 6, 11]);
      for (const ex of exList) {
        const val = typeof ex.max_attempts === 'number' ? ex.max_attempts : ex.allow_retake ? 0 : 1;
        nextDraft[ex.id] = val;
        if (!presets.has(val)) nextCustom[ex.id] = true;
      }
      setAttemptsDraft(nextDraft);
      setCustomAttemptsMap(nextCustom);
    }
    if (secRes.data) {
      const pm: Record<string, string> = {};
      for (const r of secRes.data) pm[r.exam_id] = r.require_pin || '';
      setPinMap(pm);
    }
    if (scRes.data) setScores(scRes.data as ScoreRow[]);
    if (sessRes.data) setActiveSessions(sessRes.data as SessionMonitorRow[]);
  }, [isTeacherAdmin]);

  const loadQuestionBank = useCallback(async (g: string) => {
    if (!isTeacherAdmin) return;
    const { data } = await supabase
      .from('questions')
      .select('id, grade, subject, indicator, question_text, choice_1, choice_2, choice_3, choice_4, question_keys(correct_choice, explanation)')
      .eq('grade', g)
      .order('id', { ascending: true });
    if (data) setBankRows(data as unknown as QuestionBankRow[]);
  }, [isTeacherAdmin]);

  useEffect(() => {
    void verifySession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void verifySession();
    });
    return () => subscription.unsubscribe();
  }, [verifySession]);

  useEffect(() => {
    if (!isTeacherAdmin) return;
    void loadAllAdminData();

    const ch = supabase
      .channel('admin-realtime-monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams' }, () => void loadAllAdminData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, () => void loadAllAdminData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_sessions' }, () => void loadAllAdminData())
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [isTeacherAdmin, loadAllAdminData]);

  useEffect(() => {
    if (activeTab === 'bank' && isTeacherAdmin) {
      void loadQuestionBank(bankGrade);
    }
  }, [activeTab, bankGrade, isTeacherAdmin, loadQuestionBank]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAuthErr('');
    setLoggingIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPass,
      });
      if (error) throw error;
      await verifySession();
    } catch (err: unknown) {
      setAuthErr(err instanceof Error ? err.message : String(err));
    } finally {
      setLoggingIn(false);
    }
  };

  const toggleExamApproval = async (ex: ExamCatalogRow, nextState: boolean) => {
    setBusyId(ex.id);
    const { error } = await supabase
      .from('exams')
      .update({ approved: nextState, updated_at: new Date().toISOString() })
      .eq('id', ex.id);
    if (error) alert('อัปเดตไม่สำเร็จ: ' + error.message);
    await loadAllAdminData();
    setBusyId('');
  };

  const bulkApproval = async (scope: 'ALL_LOCK' | 'M2_PRE' | 'M2_POST', nextState: boolean) => {
    const label = scope === 'ALL_LOCK' ? 'ปิดอนุมัติข้อสอบทั้งหมดทันที' : `เปลี่ยนสถานะกลุ่ม ${scope}`;
    if (!window.confirm(`ยืนยัน ${label}?`)) return;

    let targets = exams;
    if (scope === 'M2_PRE') targets = exams.filter((e) => e.id.startsWith('P') && e.id.endsWith('_PRE'));
    if (scope === 'M2_POST') targets = exams.filter((e) => e.id.startsWith('P') && e.id.endsWith('_POST'));

    const ids = targets.map((t) => t.id);
    if (ids.length === 0) return;

    const { error } = await supabase
      .from('exams')
      .update({ approved: nextState, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) alert('ดำเนินการไม่สำเร็จ: ' + error.message);
    await loadAllAdminData();
  };

  const saveExamRowSettings = async (ex: ExamCatalogRow) => {
    setBusyId(ex.id);
    const roomsEl = document.getElementById(`rooms-${ex.id}`) as HTMLInputElement | null;
    const timeEl = document.getElementById(`time-${ex.id}`) as HTMLInputElement | null;
    const qCntEl = document.getElementById(`qcnt-${ex.id}`) as HTMLInputElement | null;
    const pinEl = document.getElementById(`pin-${ex.id}`) as HTMLInputElement | null;
    const rqEl = document.getElementById(`rq-${ex.id}`) as HTMLInputElement | null;
    const rcEl = document.getElementById(`rc-${ex.id}`) as HTMLInputElement | null;
    const rvEl = document.getElementById(`rv-${ex.id}`) as HTMLInputElement | null;

    const rawMaxAttempts =
      attemptsDraft[ex.id] ?? (typeof ex.max_attempts === 'number' ? ex.max_attempts : ex.allow_retake ? 0 : 1);
    const maxAttempts = Math.max(0, Math.min(99, Math.trunc(Number(rawMaxAttempts))));

    const roomsArr = (roomsEl?.value || 'ทั้งหมด')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const { error: exErr } = await supabase
      .from('exams')
      .update({
        time_limit_min: Number(timeEl?.value || ex.time_limit_min) || 10,
        question_count: Number(qCntEl?.value || ex.question_count) || 10,
        approved_rooms: roomsArr.length ? roomsArr : ['ทั้งหมด'],
        random_questions: Boolean(rqEl?.checked),
        random_choices: Boolean(rcEl?.checked),
        allow_retake: maxAttempts !== 1,
        max_attempts: maxAttempts,
        show_review: Boolean(rvEl?.checked),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ex.id);

    if (exErr) {
      alert('บันทึกตั้งค่าไม่สำเร็จ: ' + exErr.message);
      setBusyId('');
      return;
    }

    const pinText = (pinEl?.value || '').trim();
    const { error: secErr } = await supabase
      .from('exam_secrets')
      .upsert({ exam_id: ex.id, require_pin: pinText, updated_at: new Date().toISOString() });

    if (secErr) alert('บันทึก PIN ไม่สำเร็จ: ' + secErr.message);
    else alert(`บันทึกการตั้งค่า ${ex.id} สำเร็จ!`);

    await loadAllAdminData();
    setBusyId('');
  };

  const filteredExams = useMemo(() => {
    return exams.filter((e) => {
      if (gradeFilter !== 'ALL' && e.grade !== gradeFilter) return false;
      if (catFilter !== 'ALL' && !e.category.includes(catFilter)) return false;
      return true;
    });
  }, [exams, gradeFilter, catFilter]);

  const gainRows = useMemo(() => {
    const map: Record<string, { name: string; room: string; planNo: number; pre: number | null; post: number | null }> = {};
    for (const s of scores) {
      const m = s.exam_id.match(/^P(\d{2})_(PRE|POST)$/);
      if (!m) continue;
      const planNo = parseInt(m[1], 10);
      const key = `${s.student_name}|${s.student_room}|${planNo}`;
      if (!map[key]) map[key] = { name: s.student_name, room: s.student_room, planNo, pre: null, post: null };
      if (m[2] === 'PRE') map[key].pre = s.score;
      else map[key].post = s.score;
    }
    return Object.values(map).sort((a, b) => a.planNo - b.planNo || a.room.localeCompare(b.room));
  }, [scores]);

  const filteredScores = useMemo(() => {
    return scores.filter((s) => roomFilter === 'ALL' || s.student_room === roomFilter);
  }, [scores, roomFilter]);

  const exportCsv = () => {
    const header = ['SubmittedAt', 'Grade', 'Room', 'Code', 'Name', 'ExamID', 'Score', 'MaxScore', 'Percent', 'TimeSec'];
    const lines = [
      header.join(','),
      ...filteredScores.map((r) =>
        [
          `"${r.submitted_at}"`,
          `"${r.grade}"`,
          `"${r.student_room}"`,
          `"${r.student_code}"`,
          `"${r.student_name.replace(/"/g, '""')}"`,
          `"${r.exam_id}"`,
          r.score,
          r.max_score,
          r.percentage,
          r.time_spent_sec,
        ].join(',')
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'onet_cbt_supabase_scores.csv';
    a.click();
  };

  if (!authChecked) {
    return <div className="container"><div className="card">กำลังตรวจสอบสิทธิ์ครูผู้สอน...</div></div>;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="onet-header" style={{ background: 'linear-gradient(135deg, #0f172a, #1e293b)' }}>
        <div className="brand-row">
          <div className="brand-badge" style={{ background: '#10b981', color: '#fff' }}>BACK-END</div>
          <div>
            <h1 style={{ fontSize: 18 }}>ระบบหลังบ้านครูผู้สอน — ระบบทดสอบวัดผลการเรียนออนไลน์</h1>
            <p style={{ fontSize: 12, color: '#cbd5e1' }}>
              {isTeacherAdmin ? `ล็อกอินแล้ว: ${teacherEmail} • เชื่อม Realtime เปิดอยู่` : 'กรุณาเข้าสู่ระบบด้วยบัญชีครูผู้สอนเพื่อจัดการสิทธิ์ข้อสอบ'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-teal" onClick={onGoStudent}>👨‍🎓 ดูหน้าห้องสอบนักเรียน</button>
          {isTeacherAdmin && (
            <>
              <button className="btn btn-danger" onClick={() => void bulkApproval('ALL_LOCK', false)}>
                <Lock size={15} /> ปิดสอบทุกชุดทันที
              </button>
              <button className="btn btn-secondary" onClick={() => void supabase.auth.signOut()}>
                <LogOut size={15} /> ออกจากระบบ
              </button>
            </>
          )}
        </div>
      </header>

      <main className="container" style={{ flex: 1 }}>
        {!isSupabaseConfigured && (
          <div className="card" style={{ borderColor: 'var(--red)', background: '#fef2f2' }}>
            <h3 style={{ color: 'var(--red)' }}>⚠ ยังไม่ได้กำหนดค่าเชื่อมต่อ Supabase (.env.local)</h3>
            <p style={{ marginTop: 6, fontSize: 14 }}>
              สร้างโปรเจกต์ Supabase แล้วคัดลอก <code>.env.example</code> เป็น <code>.env.local</code> จากนั้นใส่ <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
            </p>
          </div>
        )}

        {/* TEACHER LOGIN GATE */}
        {!isTeacherAdmin ? (
          <div className="card" style={{ maxWidth: 460, margin: '40px auto' }}>
            <h2 style={{ color: 'var(--navy)', marginBottom: 6 }}>🔐 เข้าสู่ระบบหลังบ้านครูผู้สอน</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 16 }}>
              ใช้บัญชีอีเมลที่ลงทะเบียนไว้ใน Supabase Auth และมีสิทธิ์ในตาราง <code>teacher_admins</code>
            </p>
            {teacherEmail && (
              <div style={{ padding: 12, background: '#fef3c7', color: '#92400e', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
                <ShieldAlert size={16} style={{ verticalAlign: 'middle', marginRight: 5 }} />
                บัญชี <strong>{teacherEmail}</strong> ยังไม่ได้รับสิทธิ์ในตาราง <code>public.teacher_admins</code> กรุณารัน SQL เพิ่มสิทธิ์ใน Supabase SQL Editor:
                <pre style={{ marginTop: 6, background: '#fff', padding: 8, borderRadius: 6, overflowX: 'auto', fontSize: 12 }}>
{`INSERT INTO public.teacher_admins (user_id, email)
SELECT id, email FROM auth.users
WHERE email = '${teacherEmail}';`}
                </pre>
              </div>
            )}
            <form onSubmit={(e) => void handleLogin(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 14 }}>อีเมลครูผู้สอน</label>
                <input className="input" type="email" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="kimman130@maetamwit.ac.th" />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 14 }}>รหัสผ่าน</label>
                <input className="input" type="password" required value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="••••••••" />
              </div>
              {authErr && <div style={{ color: 'var(--red)', fontSize: 13 }}>{authErr}</div>}
              <button className="btn btn-primary" type="submit" disabled={loggingIn} style={{ padding: 11 }}>
                {loggingIn ? 'กำลังตรวจสอบ...' : '🔓 เข้าสู่ระบบหลังบ้าน Back-End'}
              </button>
            </form>
          </div>
        ) : (
          <>
            {/* KPI Bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 18 }}>
              <div className="card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>ชุดข้อสอบทั้งหมด (ม.1–ม.3)</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--navy)' }}>{exams.length} ชุด</div>
              </div>
              <div className="card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>กำลังอนุมัติเปิดสอบอยู่</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)' }}>
                  {exams.filter((e) => e.approved).length} ชุด
                </div>
              </div>
              <div className="card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>นักเรียนกำลังทำข้อสอบสด</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--amber)' }}>
                  <Radio size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  {activeSessions.length} คน
                </div>
              </div>
              <div className="card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>ส่งข้อสอบแล้วทั้งหมด</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--blue)' }}>{scores.length} ครั้ง</div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <button className={`btn ${activeTab === 'approvals' ? 'btn-navy' : 'btn-secondary'}`} onClick={() => setActiveTab('approvals')}>
                <Unlock size={16} /> 1. อนุมัติเปิด-ปิดชุดสอบ ({exams.length} ชุด)
              </button>
              <button className={`btn ${activeTab === 'scores' ? 'btn-navy' : 'btn-secondary'}`} onClick={() => setActiveTab('scores')}>
                <Activity size={16} /> 2. จอมอนิเตอร์สด คะแนน & Gain Score
              </button>
              <button className={`btn ${activeTab === 'bank' ? 'btn-navy' : 'btn-secondary'}`} onClick={() => setActiveTab('bank')}>
                <BookOpen size={16} /> 3. คลังข้อสอบ 1,080 ข้อ (ม.1–ม.3)
              </button>
            </div>

            {/* TAB 1: APPROVAL MATRIX */}
            {activeTab === 'approvals' && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select className="input" style={{ width: 140 }} value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
                      <option value="ม.2">เฉพาะ ม.2</option>
                      <option value="ม.1">เฉพาะ ม.1</option>
                      <option value="ม.3">เฉพาะ ม.3</option>
                      <option value="ALL">ทุกชั้น (54)</option>
                    </select>
                    <select className="input" style={{ width: 190 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                      <option value="ALL">ทุกประเภทแบบทดสอบ</option>
                      <option value="Pre-test">ก่อนเรียน (Pre-test)</option>
                      <option value="Post-test">หลังเรียน (Post-test)</option>
                      <option value="ท้ายหน่วย">ท้ายหน่วย (Unit)</option>
                      <option value="ภาคเรียน">กลางภาค / ปลายภาค</option>
                      <option value="คลังตัวชี้วัด">คลังรายตัวชี้วัด</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-teal" onClick={() => void bulkApproval('M2_PRE', true)}>🔓 เปิด Pre-test ม.2 ทั้ง 10 แผน</button>
                    <button className="btn btn-primary" onClick={() => void bulkApproval('M2_POST', true)}>🔓 เปิด Post-test ม.2 ทั้ง 10 แผน</button>
                    <button className="btn btn-secondary" onClick={() => void loadAllAdminData()}><RefreshCw size={15} /></button>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>อนุมัติ</th>
                        <th style={{ width: 95 }}>สถานะ</th>
                        <th>ชุดสอบ / ตัวชี้วัด</th>
                        <th style={{ width: 65 }}>ข้อสอบ</th>
                        <th style={{ width: 65 }}>เวลา(น.)</th>
                        <th style={{ width: 175 }}>ทดสอบซ้ำ (จำนวนครั้ง)</th>
                        <th style={{ width: 115 }}>ห้องที่เข้าสอบ</th>
                        <th style={{ width: 85 }}>PIN เข้าสอบ</th>
                        <th style={{ width: 135 }}>ตั้งค่าสุ่ม & เฉลย</th>
                        <th style={{ width: 100 }}>บันทึก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExams.map((ex) => (
                        <tr key={ex.id} style={{ background: ex.approved ? '#f0fdf4' : '#ffffff' }}>
                          <td style={{ textAlign: 'center' }}>
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={ex.approved}
                                disabled={busyId === ex.id}
                                onChange={(e) => void toggleExamApproval(ex, e.target.checked)}
                              />
                              <span className="slider" />
                            </label>
                          </td>
                          <td>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 700,
                                background: ex.approved ? '#dcfce7' : '#fee2e2',
                                color: ex.approved ? '#166534' : '#991b1b',
                              }}
                            >
                              {ex.approved ? '🟢 อนุมัติ' : '🔒 ปิดอยู่'}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>[{ex.grade}] {ex.id} — {ex.title}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ex.category} | {ex.indicators}</div>
                          </td>
                          <td><input id={`qcnt-${ex.id}`} type="number" className="input" defaultValue={ex.question_count} min={1} max={40} style={{ padding: '4px 6px' }} /></td>
                          <td><input id={`time-${ex.id}`} type="number" className="input" defaultValue={ex.time_limit_min} min={1} max={180} style={{ padding: '4px 6px' }} /></td>
                          <td>
                            {(() => {
                              const currentVal = attemptsDraft[ex.id] ?? (typeof ex.max_attempts === 'number' ? ex.max_attempts : ex.allow_retake ? 0 : 1);
                              const presetNums = [0, 1, 2, 3, 4, 5, 6, 11];
                              const isCustom = Boolean(customAttemptsMap[ex.id]) || !presetNums.includes(currentVal);
                              const retakeVal = Math.max(0, currentVal > 0 ? currentVal - 1 : 0);
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <select
                                    id={`retake-select-${ex.id}`}
                                    className="input"
                                    style={{ padding: '4px 6px', fontSize: 12 }}
                                    value={isCustom ? 'custom' : String(currentVal)}
                                    onChange={(e) => {
                                      if (e.target.value === 'custom') {
                                        setCustomAttemptsMap((prev) => ({ ...prev, [ex.id]: true }));
                                        if (currentVal <= 1) {
                                          setAttemptsDraft((prev) => ({ ...prev, [ex.id]: 2 }));
                                        }
                                      } else {
                                        const picked = Number(e.target.value);
                                        setCustomAttemptsMap((prev) => ({ ...prev, [ex.id]: false }));
                                        setAttemptsDraft((prev) => ({ ...prev, [ex.id]: picked }));
                                      }
                                    }}
                                  >
                                    <option value="1">ไม่ให้สอบซ้ำ (รวม 1 ครั้ง)</option>
                                    <option value="2">ซ้ำได้ 1 ครั้ง (รวม 2 ครั้ง)</option>
                                    <option value="3">ซ้ำได้ 2 ครั้ง (รวม 3 ครั้ง)</option>
                                    <option value="4">ซ้ำได้ 3 ครั้ง (รวม 4 ครั้ง)</option>
                                    <option value="5">ซ้ำได้ 4 ครั้ง (รวม 5 ครั้ง)</option>
                                    <option value="6">ซ้ำได้ 5 ครั้ง (รวม 6 ครั้ง)</option>
                                    <option value="11">ซ้ำได้ 10 ครั้ง (รวม 11 ครั้ง)</option>
                                    <option value="0">ซ้ำได้ไม่จำกัด (∞)</option>
                                    <option value="custom">กำหนดจำนวนซ้ำเอง...</option>
                                  </select>
                                  {isCustom && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                      <span>ซ้ำได้</span>
                                      <input
                                        id={`retake-custom-${ex.id}`}
                                        type="number"
                                        className="input"
                                        min={0}
                                        max={98}
                                        value={retakeVal}
                                        onChange={(e) => {
                                          const k = Math.max(0, Math.min(98, Math.trunc(Number(e.target.value) || 0)));
                                          setAttemptsDraft((prev) => ({ ...prev, [ex.id]: k + 1 }));
                                        }}
                                        style={{ padding: '2px 5px', width: 54, fontSize: 12 }}
                                      />
                                      <span style={{ color: 'var(--muted)' }}>ครั้ง (รวม {retakeVal + 1})</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td><input id={`rooms-${ex.id}`} type="text" className="input" defaultValue={ex.approved_rooms.join(', ')} style={{ padding: '4px 6px', fontSize: 13 }} /></td>
                          <td><input id={`pin-${ex.id}`} type="text" className="input" defaultValue={pinMap[ex.id] || ''} placeholder="ว่าง=ไม่ใช้" style={{ padding: '4px 6px', fontSize: 13 }} /></td>
                          <td style={{ fontSize: 12 }}>
                            <label><input id={`rq-${ex.id}`} type="checkbox" defaultChecked={ex.random_questions} /> สุ่มข้อ</label><br />
                            <label><input id={`rc-${ex.id}`} type="checkbox" defaultChecked={ex.random_choices} /> สุ่มช้อยส์</label><br />
                            <label><input id={`rv-${ex.id}`} type="checkbox" defaultChecked={ex.show_review} /> แสดงเฉลย</label>
                          </td>
                          <td>
                            <button className="btn btn-primary" style={{ padding: '6px 10px', fontSize: 12, width: '100%' }} disabled={busyId === ex.id} onClick={() => void saveExamRowSettings(ex)}>
                              <Save size={13} /> บันทึก
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 2: SCORES & LIVE MONITOR */}
            {activeTab === 'scores' && (
              <>
                <div className="card">
                  <h3 style={{ color: 'var(--navy)', marginBottom: 10 }}>📡 นักเรียนที่กำลังสอบอยู่ในขณะนี้ ({activeSessions.length} คน — Realtime)</h3>
                  {activeSessions.length === 0 ? (
                    <p style={{ fontSize: 14, color: 'var(--muted)' }}>ไม่มีผู้สอบที่กำลังทำข้อสอบค้างอยู่</p>
                  ) : (
                    <table className="tbl">
                      <thead><tr><th>ชุดสอบ</th><th>ห้อง</th><th>รหัส</th><th>ชื่อ-สกุล</th><th>เวลาเริ่มสอบ</th></tr></thead>
                      <tbody>
                        {activeSessions.map((s) => (
                          <tr key={s.id}>
                            <td><strong>{s.exam_id}</strong></td>
                            <td>{s.student_room}</td>
                            <td>{s.student_code}</td>
                            <td>{s.student_name}</td>
                            <td>{new Date(s.started_at).toLocaleTimeString('th-TH')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                    <h3 style={{ color: 'var(--navy)' }}>📈 สรุปผลพัฒนาการ Pre-test vs Post-test (Gain Score)</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select className="input" style={{ width: 130 }} value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
                        <option value="ALL">ทุกห้อง</option>
                        {['ม.2/1', 'ม.2/2', 'ม.2/3', 'ม.2/4', 'ม.2/5', 'ม.1/1', 'ม.3/1'].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button className="btn btn-success" onClick={exportCsv}>
                        <Download size={15} /> Export CSV ปพ.5
                      </button>
                    </div>
                  </div>
                  <table className="tbl" style={{ marginBottom: 20 }}>
                    <thead><tr><th>ชื่อ-สกุล</th><th>ห้อง</th><th>แผนที่</th><th>Pre-test</th><th>Post-test</th><th>Gain</th></tr></thead>
                    <tbody>
                      {gainRows.length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>ยังไม่มีข้อมูล Pre/Post เปรียบเทียบ</td></tr>
                      ) : (
                        gainRows.map((g, i) => {
                          const gain = g.pre !== null && g.post !== null ? g.post - g.pre : null;
                          return (
                            <tr key={i}>
                              <td>{g.name}</td>
                              <td>{g.room}</td>
                              <td>แผนที่ {g.planNo}</td>
                              <td>{g.pre ?? '-'}</td>
                              <td>{g.post ?? '-'}</td>
                              <td style={{ fontWeight: 700, color: gain && gain > 0 ? 'var(--green)' : 'inherit' }}>
                                {gain === null ? '-' : `${gain >= 0 ? '+' : ''}${gain}`}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>

                  <h3 style={{ color: 'var(--navy)', marginBottom: 10 }}>ประวัติการส่งข้อสอบทั้งหมด ({filteredScores.length})</h3>
                  <table className="tbl">
                    <thead><tr><th>วันเวลา</th><th>ห้อง</th><th>รหัส</th><th>ชื่อ-สกุล</th><th>ชุดสอบ</th><th>คะแนน</th><th>ร้อยละ</th></tr></thead>
                    <tbody>
                      {filteredScores.map((s) => (
                        <tr key={s.id}>
                          <td>{new Date(s.submitted_at).toLocaleString('th-TH')}</td>
                          <td>{s.student_room}</td>
                          <td>{s.student_code}</td>
                          <td>{s.student_name}</td>
                          <td>{s.exam_id}</td>
                          <td><strong>{s.score}/{s.max_score}</strong></td>
                          <td>{s.percentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* TAB 3: QUESTION BANK 1,080 ITEMS */}
            {activeTab === 'bank' && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ color: 'var(--navy)' }}>คลังข้อสอบพร้อมเฉลยลับ ({bankRows.length} ข้อ ในระดับชั้น {bankGrade})</h3>
                  <select className="input" style={{ width: 170 }} value={bankGrade} onChange={(e) => setBankGrade(e.target.value)}>
                    <option value="ม.1">ชั้น ม.1 (360 ข้อ)</option>
                    <option value="ม.2">ชั้น ม.2 (360 ข้อ)</option>
                    <option value="ม.3">ชั้น ม.3 (360 ข้อ)</option>
                  </select>
                </div>
                {bankRows.map((q, idx) => (
                  <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 14 }}>
                      {idx + 1}. [{q.id}] ({q.indicator}) — {q.question_text}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 6, color: '#334155' }}>
                      ก. {q.choice_1} | ข. {q.choice_2} | ค. {q.choice_3} | ง. {q.choice_4}
                    </div>
                    {q.question_keys && (
                      <div style={{ fontSize: 13, marginTop: 6, color: 'var(--green)', fontWeight: 600 }}>
                        ✔ เฉลย: ข้อ {THAI_LETTERS[q.question_keys.correct_choice]} — {q.question_keys.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
