import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Flag,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Shuffle,
  UserCheck,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { validateStudentCredentials } from '../lib/studentAuth';
import type { ExamCatalogRow, ExamResultPayload, SanitizedQuestion } from '../types';

interface Props {
  onGoAdmin: () => void;
}

const ROOMS_BY_GRADE: Record<string, string[]> = {
  ALL: [
    'ม.1/1', 'ม.1/2', 'ม.1/3', 'ม.1/4',
    'ม.2/1', 'ม.2/2', 'ม.2/3', 'ม.2/4', 'ม.2/5',
    'ม.3/1', 'ม.3/2', 'ม.3/3', 'ม.3/4',
  ],
  'ม.1': ['ม.1/1', 'ม.1/2', 'ม.1/3', 'ม.1/4'],
  'ม.2': ['ม.2/1', 'ม.2/2', 'ม.2/3', 'ม.2/4', 'ม.2/5'],
  'ม.3': ['ม.3/1', 'ม.3/2', 'ม.3/3', 'ม.3/4'],
};

const THAI_LETTERS = ['ก', 'ข', 'ค', 'ง'];

export default function StudentPortal({ onGoAdmin }: Props) {
  const [view, setView] = useState<'login' | 'lobby' | 'exam' | 'result'>('login');
  const [gradeFilter, setGradeFilter] = useState<string>('ม.2');
  const [catFilter, setCatFilter] = useState<string>('ALL');

  // Student Auth Inputs (เก็บในหน่วยความจำเท่านั้น ไม่บันทึกรหัสผ่านลงฐานข้อมูล)
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [studentEmail, setStudentEmail] = useState<string>('');
  const [studentPassword, setStudentPassword] = useState<string>('');
  const [studentCode, setStudentCode] = useState<string>('');
  const [studentName, setStudentName] = useState<string>(() => sessionStorage.getItem('sb_name') || '');
  const [studentRoom, setStudentRoom] = useState<string>(() => sessionStorage.getItem('sb_room') || 'ม.2/1');

  const [approvedExams, setApprovedExams] = useState<ExamCatalogRow[]>([]);
  const [loadingLobby, setLoadingLobby] = useState<boolean>(false);
  const [lobbyError, setLobbyError] = useState<string>('');

  // Exam Room State
  const [sessionId, setSessionId] = useState<string>('');
  const [activeExam, setActiveExam] = useState<ExamCatalogRow | null>(null);
  const [questions, setQuestions] = useState<SanitizedQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [timerSec, setTimerSec] = useState<number>(0);
  const [totalAllocSec, setTotalAllocSec] = useState<number>(0);
  const [stemFontPx, setStemFontPx] = useState<number>(20);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Modals & Result
  const [pinModalExam, setPinModalExam] = useState<ExamCatalogRow | null>(null);
  const [pinInput, setPinInput] = useState<string>('');
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState<boolean>(false);
  const [resultData, setResultData] = useState<ExamResultPayload | null>(null);

  useEffect(() => {
    sessionStorage.setItem('sb_name', studentName);
    sessionStorage.setItem('sb_room', studentRoom);
  }, [studentName, studentRoom]);

  const fetchApprovedLobby = useCallback(async () => {
    if (!isSupabaseConfigured || !studentEmail) {
      if (!isSupabaseConfigured) {
        setLobbyError('ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_PUBLISHABLE_KEY ในไฟล์ .env.local');
      }
      return;
    }
    setLoadingLobby(true);
    setLobbyError('');
    try {
      const { data, error } = await supabase.functions.invoke('onet-exam', {
        body: {
          action: 'lobby',
          grade: gradeFilter,
          studentCode,
          studentName: studentName.trim(),
          studentRoom: studentRoom.trim(),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'โหลดรายการสอบไม่สำเร็จ');
      setApprovedExams(data.approvedExams || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLobbyError(msg);
    } finally {
      setLoadingLobby(false);
    }
  }, [gradeFilter, studentEmail, studentCode, studentName, studentRoom]);

  useEffect(() => {
    if (view === 'lobby') {
      void fetchApprovedLobby();
    }
  }, [view, fetchApprovedLobby]);

  // Realtime listener: อัปเดตรายการข้อสอบที่ครูอนุมัติหรือล็อกทันที
  useEffect(() => {
    if (!isSupabaseConfigured || view !== 'lobby') return;
    const channel = supabase
      .channel('public:exams-lobby')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exams' },
        () => {
          void fetchApprovedLobby();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchApprovedLobby, view]);

  const submitExamToServer = useCallback(async () => {
    if (!sessionId || submitting) return;
    setConfirmSubmitOpen(false);
    setSubmitting(true);
    try {
      const timeSpentSec = Math.max(0, totalAllocSec - timerSec);
      const { data, error } = await supabase.functions.invoke('onet-exam', {
        body: {
          action: 'submit',
          sessionId,
          answers,
          timeSpentSec,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'ส่งคำตอบไม่สำเร็จ');
      setResultData(data as ExamResultPayload);
      setView('result');
    } catch (err: unknown) {
      alert('เกิดข้อผิดพลาดในการส่งคำตอบ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, submitting, totalAllocSec, timerSec, answers]);

  useEffect(() => {
    if (view !== 'exam' || timerSec <= 0) return;
    const handle = window.setInterval(() => {
      setTimerSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(handle);
          void submitExamToServer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(handle);
  }, [view, timerSec, submitExamToServer]);

  const handleStudentLogin = (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const check = validateStudentCredentials(loginEmail, loginPassword);
    if (!check.valid) {
      setLoginError(check.error || 'รูปแบบอีเมลหรือรหัสผ่านไม่ถูกต้อง');
      return;
    }
    if (!studentName.trim() || !studentRoom.trim()) {
      setLoginError('กรุณากรอกชื่อ-นามสกุล และเลือกห้องเรียน');
      return;
    }

    setStudentCode(check.studentCode);
    setStudentEmail(check.normalizedEmail);
    setStudentPassword(loginPassword.trim());
    setView('lobby');
  };

  const handleStudentLogout = () => {
    setStudentEmail('');
    setStudentPassword('');
    setStudentCode('');
    setLoginPassword('');
    setApprovedExams([]);
    setResultData(null);
    setView('login');
  };

  const startExamRequest = async (exam: ExamCatalogRow, pin = '') => {
    setLoadingLobby(true);
    try {
      const { data, error } = await supabase.functions.invoke('onet-exam', {
        body: {
          action: 'start',
          examId: exam.id,
          studentEmail,
          studentPassword,
          studentName: studentName.trim(),
          studentRoom: studentRoom.trim(),
          pin,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'ไม่สามารถเข้าห้องสอบได้');

      setPinModalExam(null);
      setPinInput('');
      setSessionId(data.sessionId);
      setActiveExam(exam);
      setQuestions(data.questions || []);
      setAnswers({});
      setFlagged(new Set());
      setCurrentIdx(0);

      const alloc = (data.examMeta?.time_limit_min || exam.time_limit_min || 10) * 60;
      setTotalAllocSec(alloc);
      setTimerSec(alloc);
      setView('exam');
    } catch (err: unknown) {
      alert('⛔ ไม่สามารถเข้าสอบได้: ' + (err instanceof Error ? err.message : String(err)));
      void fetchApprovedLobby();
    } finally {
      setLoadingLobby(false);
    }
  };

  const handleClickStart = (exam: ExamCatalogRow) => {
    if (exam.has_pin) {
      setPinInput('');
      setPinModalExam(exam);
    } else {
      void startExamRequest(exam, '');
    }
  };

  const filteredExams = useMemo(() => {
    return approvedExams.filter((ex) => {
      if (catFilter === 'ALL') return true;
      return ex.category.includes(catFilter);
    });
  }, [approvedExams, catFilter]);

  const formatClock = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const currentQ = questions[currentIdx];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="onet-header">
        <div className="brand-row">
          <div className="brand-badge">ONLINE TEST</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>ระบบทดสอบวัดผลการเรียนออนไลน์</h1>
            <p style={{ fontSize: 12, color: '#cbd5e1' }}>
              เทคโนโลยี (ว 4.1 / ว 4.2) โรงเรียนแม่ต๋ำตาดควันวิทยาคม
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {studentEmail && (
            <div style={{ background: 'rgba(255,255,255,0.14)', padding: '6px 12px', borderRadius: 999, fontSize: 13 }}>
              <UserCheck size={15} style={{ verticalAlign: 'middle', marginRight: 5 }} />
              {studentEmail} • {studentName} ({studentRoom})
            </div>
          )}
          {view === 'lobby' && (
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={handleStudentLogout}>
              <LogOut size={14} /> ออกจากระบบ
            </button>
          )}
          {view === 'exam' && (
            <div className={`timer-box ${timerSec <= 120 ? 'timer-warning' : ''}`}>
              <Clock size={18} />
              <span>{formatClock(timerSec)}</span>
            </div>
          )}
        </div>
      </header>

      <main className="container" style={{ flex: 1 }}>
        {/* VIEW 0: STUDENT LOGIN GATE */}
        {view === 'login' && (
          <div className="card" style={{ maxWidth: 520, margin: '28px auto' }}>
            <h2 style={{ color: 'var(--navy)', marginBottom: 6 }}>ลงชื่อเข้าทำแบบทดสอบสำหรับนักเรียน</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 14 }}>
              เข้าสู่ระบบด้วยอีเมลโรงเรียนและรหัสผ่านประจำตัว (ระบบตรวจสอบรูปแบบอัตโนมัติ ไม่ต้องสมัครสมาชิก)
            </p>

            <div style={{ padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 13, marginBottom: 16, color: '#1e3a8a' }}>
              <strong>ตัวอย่างรูปแบบการเข้าสอบ:</strong>
              <div>• อีเมลโรงเรียน: <code>mt00000@maetamwit.ac.th</code> (แทน <code>00000</code> ด้วยเลขประจำตัว 5 หลัก)</div>
              <div>• รหัสผ่าน: <code>Mtwit00000</code> (ขึ้นต้นด้วย <code>Mtwit</code> ตามด้วยเลข 5 หลักเดียวกัน)</div>
            </div>

            <form onSubmit={handleStudentLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 4 }}>อีเมลโรงเรียน *</label>
                <input
                  className="input"
                  type="email"
                  required
                  placeholder="mt01234@maetamwit.ac.th"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 4 }}>รหัสผ่าน *</label>
                <input
                  className="input"
                  type="password"
                  required
                  placeholder="Mtwit01234"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </div>

              <div className="form-grid">
                <div>
                  <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 4 }}>ระดับชั้น *</label>
                  <select
                    className="input"
                    value={gradeFilter}
                    onChange={(e) => {
                      const g = e.target.value;
                      setGradeFilter(g);
                      const valid = ROOMS_BY_GRADE[g] || ROOMS_BY_GRADE.ALL;
                      if (!valid.includes(studentRoom)) setStudentRoom(valid[0]);
                    }}
                  >
                    <option value="ม.2">มัธยมศึกษาปีที่ 2</option>
                    <option value="ม.1">มัธยมศึกษาปีที่ 1</option>
                    <option value="ม.3">มัธยมศึกษาปีที่ 3</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 4 }}>ห้องเรียน *</label>
                  <select className="input" value={studentRoom} onChange={(e) => setStudentRoom(e.target.value)}>
                    {(ROOMS_BY_GRADE[gradeFilter] || ROOMS_BY_GRADE.ALL).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 4 }}>ชื่อ - นามสกุล *</label>
                <input
                  className="input"
                  required
                  placeholder="เช่น ด.ช.รักเรียน เทคโนโลยี"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                />
              </div>

              {loginError && (
                <div style={{ padding: 10, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                  ⚠ {loginError}
                </div>
              )}

              <button className="btn btn-primary" type="submit" style={{ padding: 12, fontSize: 15, marginTop: 4 }}>
                <LogIn size={17} /> เข้าสู่ระบบทดสอบวัดผลการเรียนออนไลน์
              </button>
            </form>
          </div>
        )}

        {/* VIEW 1: APPROVED LOBBY */}
        {view === 'lobby' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h2 style={{ color: 'var(--navy)', fontSize: 20 }}>
                  รายการแบบทดสอบที่ครูอนุมัติเปิดสอบ ({filteredExams.length} ชุด)
                </h2>
                <p style={{ fontSize: 14, color: 'var(--muted)' }}>
                  รหัสนักเรียน {studentCode} • ห้อง {studentRoom} — แสดงเฉพาะแบบทดสอบที่ครูผู้สอนเปิดอนุญาตจากหลังบ้าน
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  className="input"
                  style={{ width: 145, padding: '6px 10px' }}
                  value={gradeFilter}
                  onChange={(e) => setGradeFilter(e.target.value)}
                >
                  <option value="ม.2">เฉพาะ ม.2</option>
                  <option value="ม.1">เฉพาะ ม.1</option>
                  <option value="ม.3">เฉพาะ ม.3</option>
                  <option value="ALL">ทุกชั้น</option>
                </select>
                <button className="btn btn-secondary" onClick={() => void fetchApprovedLobby()} disabled={loadingLobby}>
                  <RefreshCw size={16} /> รีเฟรช
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {[
                ['ALL', 'ทั้งหมดที่เปิด'],
                ['Pre-test', 'ก่อนเรียน'],
                ['Post-test', 'หลังเรียน (สุ่ม)'],
                ['ท้ายหน่วย', 'ท้ายหน่วย'],
                ['ภาคเรียน', 'กลางภาค/ปลายภาค'],
                ['คลังตัวชี้วัด', 'รายตัวชี้วัด'],
              ].map(([k, lbl]) => (
                <button
                  key={k}
                  className={`btn ${catFilter === k ? 'btn-navy' : 'btn-secondary'}`}
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => setCatFilter(k)}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {lobbyError && (
              <div style={{ marginTop: 14, padding: 14, background: '#fef2f2', color: '#991b1b', borderRadius: 10 }}>
                ⚠ {lobbyError}
              </div>
            )}

            {!lobbyError && filteredExams.length === 0 && (
              <div style={{ textAlign: 'center', padding: '44px 20px', border: '2px dashed var(--border)', borderRadius: 12, marginTop: 16 }}>
                <Lock size={42} color="#64748b" style={{ marginBottom: 10 }} />
                <h3 style={{ color: 'var(--navy)' }}>ยังไม่มีแบบทดสอบที่ครูอนุมัติเปิดสอบในขณะนี้</h3>
                <p style={{ color: 'var(--muted)', marginTop: 6, fontSize: 14 }}>
                  นักเรียนจะเข้าทำได้เฉพาะชุดข้อสอบที่ครูผู้สอนกดเปิดอนุมัติจากระบบหลังบ้านเท่านั้น
                </p>
              </div>
            )}

            <div className="exam-grid" style={{ marginTop: 16 }}>
              {filteredExams.map((ex) => {
                const lockedDone = Boolean(ex.already_submitted && !ex.allow_retake);
                return (
                  <div key={ex.id} className="exam-card">
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                          {ex.grade} • {ex.category}
                        </span>
                        {ex.has_pin && (
                          <span style={{ fontSize: 12, color: '#b45309', fontWeight: 700 }}>🔐 ใช้ PIN</span>
                        )}
                      </div>
                      <h3 style={{ fontSize: 16, color: 'var(--navy)', lineHeight: 1.4 }}>{ex.title}</h3>
                      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
                        📝 {ex.question_count} ข้อ | ⏱ {ex.time_limit_min} นาที |{' '}
                        {ex.random_questions ? (
                          <>
                            <Shuffle size={13} style={{ verticalAlign: 'middle' }} /> สุ่มข้อ-สลับตัวเลือก
                          </>
                        ) : (
                          'เรียงตามชุด'
                        )}
                      </p>
                      <p style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                        ตัวชี้วัด: {ex.indicators} | ห้อง: {ex.approved_rooms.join(', ')}
                      </p>
                      {ex.previous_result && (
                        <div style={{ marginTop: 8, padding: '6px 10px', background: '#f0fdf4', color: '#166534', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                          <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          ส่งแล้ว: {ex.previous_result.score}/{ex.previous_result.max_score} ({ex.previous_result.percentage}%)
                        </div>
                      )}
                    </div>
                    <button
                      className={`btn ${lockedDone ? 'btn-secondary' : 'btn-primary'}`}
                      style={{ width: '100%', marginTop: 14 }}
                      disabled={lockedDone || loadingLobby}
                      onClick={() => handleClickStart(ex)}
                    >
                      {lockedDone ? 'ส่งคำตอบเรียบร้อยแล้ว' : ex.has_pin ? '🔐 ใส่ PIN เพื่อเริ่มสอบ' : '▶ เริ่มทำแบบทดสอบ'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 2: ONLINE EXAM ROOM */}
        {view === 'exam' && currentQ && (
          <div className="exam-workspace">
            <div className="question-panel">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 12, marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--navy)' }}>
                      ข้อที่ {currentIdx + 1} จาก {questions.length}
                    </span>
                    <span style={{ marginLeft: 10, background: '#eff6ff', color: 'var(--blue)', padding: '4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
                      ตัวชี้วัด {currentQ.indicator}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => setStemFontPx((s) => Math.max(16, s - 2))}>ก-</button>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => setStemFontPx((s) => Math.min(28, s + 2))}>ก+</button>
                  </div>
                </div>

                <div style={{ fontSize: stemFontPx, fontWeight: 600, lineHeight: 1.55, marginBottom: 20 }}>
                  {currentQ.question}
                </div>

                {currentQ.choices.map((ch, idx) => {
                  const selected = answers[currentQ.id] === ch.slot;
                  return (
                    <div
                      key={ch.slot}
                      className={`choice-card ${selected ? 'selected' : ''}`}
                      onClick={() => setAnswers((prev) => ({ ...prev, [currentQ.id]: ch.slot }))}
                    >
                      <div className="choice-circle">{THAI_LETTERS[idx] || ch.slot}</div>
                      <div style={{ fontSize: Math.max(16, stemFontPx - 3), lineHeight: 1.45 }}>{ch.text}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, borderTop: '2px solid #f1f5f9', paddingTop: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAnswers((prev) => {
                      const next = { ...prev };
                      delete next[currentQ.id];
                      return next;
                    })}
                  >
                    ล้างคำตอบ
                  </button>
                  <button
                    className={`btn btn-warning ${flagged.has(currentQ.id) ? 'active' : ''}`}
                    onClick={() => setFlagged((prev) => {
                      const next = new Set(prev);
                      if (next.has(currentQ.id)) next.delete(currentQ.id);
                      else next.add(currentQ.id);
                      return next;
                    })}
                  >
                    <Flag size={15} /> {flagged.has(currentQ.id) ? 'ติดธงแล้ว' : 'ติดธงทบทวน'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" disabled={currentIdx === 0} onClick={() => setCurrentIdx((i) => i - 1)}>
                    ◀ ก่อนหน้า
                  </button>
                  <button className="btn btn-primary" disabled={currentIdx >= questions.length - 1} onClick={() => setCurrentIdx((i) => i + 1)}>
                    ถัดไป ▶
                  </button>
                </div>
              </div>
            </div>

            <aside className="nav-panel">
              <h3 style={{ color: 'var(--navy)', fontSize: 16 }}>{activeExam?.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                ตอบแล้ว {Object.keys(answers).length} / {questions.length} ข้อ
              </p>
              <div className="nav-grid">
                {questions.map((q, idx) => {
                  const isAns = Boolean(answers[q.id]);
                  const isFlag = flagged.has(q.id);
                  const cls = [
                    'nav-btn',
                    isAns ? 'answered' : '',
                    isFlag ? 'flagged' : '',
                    idx === currentIdx ? 'current' : '',
                  ].join(' ');
                  return (
                    <button key={q.id} className={cls} onClick={() => setCurrentIdx(idx)}>
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
                <span>⬜ ยังไม่ตอบ</span>
                <span>🟩 ตอบแล้ว</span>
                <span>🟨 ติดธงทบทวน</span>
                <span>🟦 ข้อปัจจุบัน</span>
              </div>
              <button
                className="btn btn-success"
                style={{ width: '100%', padding: 12, fontSize: 16 }}
                disabled={submitting}
                onClick={() => setConfirmSubmitOpen(true)}
              >
                <Send size={17} /> {submitting ? 'กำลังส่งคำตอบ...' : 'ส่งกระดาษคำตอบ'}
              </button>
            </aside>
          </div>
        )}

        {/* VIEW 3: RESULT */}
        {view === 'result' && resultData && (
          <div style={{ maxWidth: 920, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', background: 'linear-gradient(135deg, var(--navy), var(--teal))', color: '#fff', padding: 30, borderRadius: 14, marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, marginBottom: 8 }}>{resultData.exam_title}</h2>
              <div style={{ fontSize: 52, fontWeight: 700, fontFamily: 'Prompt, sans-serif' }}>
                {resultData.score} / {resultData.maxScore}
              </div>
              <div style={{ fontSize: 20 }}>คิดเป็นร้อยละ {resultData.percentage}%</div>
              <p style={{ marginTop: 8, color: '#e0f2fe' }}>
                <ShieldCheck size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                บันทึกผลคะแนนรหัสนักเรียน {studentCode} เรียบร้อยแล้ว
              </p>
            </div>

            <div className="card">
              <h3 style={{ color: 'var(--navy)', marginBottom: 10 }}>วิเคราะห์ผลรายตัวชี้วัด</h3>
              <table className="tbl">
                <thead>
                  <tr><th>ตัวชี้วัด</th><th>คะแนนที่ได้</th><th>ร้อยละ</th><th>ระดับผล</th></tr>
                </thead>
                <tbody>
                  {Object.entries(resultData.breakdown).map(([ind, b]) => (
                    <tr key={ind}>
                      <td><strong>{ind}</strong></td>
                      <td>{b.correct} / {b.total}</td>
                      <td>{b.percentage}%</td>
                      <td>{b.percentage >= 80 ? '🌟 ดีเยี่ยม' : b.percentage >= 60 ? '✔ ผ่านเกณฑ์' : '⚠ ควรเสริม'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3 style={{ color: 'var(--navy)', marginBottom: 10 }}>เฉลยและคำอธิบาย</h3>
              {!resultData.showReview ? (
                <div style={{ padding: 14, background: '#fef3c7', color: '#92400e', borderRadius: 8, fontWeight: 600 }}>
                  🔒 ครูผู้สอนปิดการแสดงเฉลยสำหรับชุดสอบนี้ไว้เพื่อความยุติธรรมในการสอบ (ระบบบันทึกคะแนนเรียบร้อยแล้ว)
                </div>
              ) : (
                resultData.reviewData.map((r, i) => (
                  <div
                    key={r.id}
                    style={{
                      border: '1px solid var(--border)',
                      borderLeft: `6px solid ${r.isCorrect ? 'var(--green)' : 'var(--red)'}`,
                      background: r.isCorrect ? '#f0fdf4' : '#fef2f2',
                      borderRadius: 10,
                      padding: 14,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>ข้อ {i + 1} [{r.indicator}]</span>
                      <span>{r.isCorrect ? '✔ ถูก (+1)' : '✖ ผิด (0)'}</span>
                    </div>
                    <div style={{ margin: '6px 0', fontSize: 16 }}>{r.question}</div>
                    <div style={{ fontSize: 14 }}>
                      ตอบ: <strong>{r.studentChoice}</strong> | เฉลย: <strong style={{ color: 'var(--green)' }}>{r.correctChoice}</strong>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>💡 {r.explanation}</div>
                  </div>
                ))
              )}
            </div>

            <div style={{ textAlign: 'center', margin: '18px 0' }}>
              <button
                className="btn btn-navy"
                onClick={() => {
                  setView('lobby');
                  setResultData(null);
                  void fetchApprovedLobby();
                }}
              >
                🏠 กลับหน้าเลือกรายการข้อสอบ
              </button>
            </div>
          </div>
        )}
      </main>

      {pinModalExam && (
        <div className="overlay">
          <div className="modal-box">
            <h3 style={{ color: 'var(--navy)', marginBottom: 8 }}>🔐 กรอกรหัส PIN เข้าห้องสอบ</h3>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 12 }}>{pinModalExam.title}</p>
            <input
              type="password"
              className="input"
              placeholder="กรอกรหัส PIN จากครูผู้สอน"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-secondary" onClick={() => setPinModalExam(null)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={() => void startExamRequest(pinModalExam, pinInput)}>เข้าห้องสอบ ▶</button>
            </div>
          </div>
        </div>
      )}

      {confirmSubmitOpen && (
        <div className="overlay">
          <div className="modal-box">
            <h3 style={{ color: 'var(--navy)', marginBottom: 8 }}>ยืนยันการส่งกระดาษคำตอบ?</h3>
            <p style={{ fontSize: 15, marginBottom: 14 }}>
              ตอบแล้ว <strong>{Object.keys(answers).length}</strong> ข้อ | ยังไม่ตอบ{' '}
              <strong style={{ color: 'var(--red)' }}>{questions.length - Object.keys(answers).length}</strong> ข้อ | ติดธงทบทวน{' '}
              <strong>{flagged.size}</strong> ข้อ
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmSubmitOpen(false)}>กลับไปตรวจทาน</button>
              <button className="btn btn-success" onClick={() => void submitExamToServer()}>✔ ยืนยันส่งคำตอบ</button>
            </div>
          </div>
        </div>
      )}

      <footer style={{ textAlign: 'center', padding: 14, borderTop: '1px solid var(--border)', background: '#fff', fontSize: 13, color: 'var(--muted)' }}>
        ระบบทดสอบวัดผลการเรียนออนไลน์ โรงเรียนแม่ต๋ำตาดควันวิทยาคม •{' '}
        <button
          type="button"
          onClick={onGoAdmin}
          style={{ background: 'none', border: 'none', color: 'var(--navy)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
        >
          <Settings size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          เข้าสู่ระบบหลังบ้านครูผู้สอน (Back-End Approval)
        </button>
      </footer>
    </div>
  );
}
