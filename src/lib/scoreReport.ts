import type {
  ClassReportRow,
  ScoreRow,
  StudentGender,
  StudentRosterRow,
} from '../types.ts';

const MALE_PREFIXES = ['เด็กชาย', 'ด.ช.', 'นาย'];
const FEMALE_PREFIXES = ['เด็กหญิง', 'ด.ญ.', 'นางสาว', 'น.ส.', 'นาง'];

const GENDER_RANK: Record<StudentGender, number> = {
  male: 0,
  female: 1,
  other: 2,
};

const GENDER_LABEL: Record<StudentGender, string> = {
  male: 'ชาย',
  female: 'หญิง',
  other: 'ไม่ระบุ',
};

export interface GainReportRow {
  grade: string;
  studentCode: string;
  gender: StudentGender;
  genderLabel: string;
  fullName: string;
  room: string;
  planNo: number;
  pre: number | null;
  post: number | null;
  gain: number | null;
}

export function extractGradeFromText(raw: string | null | undefined): string {
  const text = (raw || '').trim();
  if (!text) return '';
  const mThai = text.match(/มัธยมศึกษาปีที่\s*([1-6])/);
  if (mThai) return `ม.${mThai[1]}`;
  const mShort = text.match(/ม\.\s*([1-6])/);
  if (mShort) return `ม.${mShort[1]}`;
  const mCls = text.match(/CLS_M([1-6])/i);
  if (mCls) return `ม.${mCls[1]}`;
  return '';
}

export function extractRoomFromStudent(student: Pick<StudentRosterRow, 'grade_level' | 'classroom_id'>): string {
  const gl = (student.grade_level || '').trim();
  const mThai = gl.match(/มัธยมศึกษาปีที่\s*([1-6])\s*\/\s*(\d+)/);
  if (mThai) return `ม.${mThai[1]}/${mThai[2]}`;
  const mShort = gl.match(/ม\.\s*([1-6])\s*\/\s*(\d+)/);
  if (mShort) return `ม.${mShort[1]}/${mShort[2]}`;
  const cid = (student.classroom_id || '').trim();
  const mCls = cid.match(/CLS_M([1-6])_(\d+)/i);
  if (mCls) return `ม.${mCls[1]}/${mCls[2]}`;
  return gl || cid;
}

export function detectGender(
  titlePrefix?: string | null,
  fallbackName?: string | null
): StudentGender {
  const candidates = [(titlePrefix || '').trim(), (fallbackName || '').trim()].filter(Boolean);
  for (const text of candidates) {
    if (MALE_PREFIXES.some((p) => text.startsWith(p))) return 'male';
    if (FEMALE_PREFIXES.some((p) => text.startsWith(p))) return 'female';
  }
  return 'other';
}

export function formatStudentFullName(
  titlePrefix?: string | null,
  name?: string | null
): string {
  const cleanName = (name || '').trim();
  const cleanPrefix = (titlePrefix || '').trim();
  if (!cleanPrefix) return cleanName;
  if (cleanName.startsWith(cleanPrefix)) return cleanName;
  return `${cleanPrefix}${cleanName}`;
}

export function compareStudentCodes(a: string, b: string): number {
  const numA = /^\d+$/.test(a) ? Number(a) : Number.NaN;
  const numB = /^\d+$/.test(b) ? Number(b) : Number.NaN;
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
    return numA - numB;
  }
  return a.localeCompare(b, 'th', { numeric: true });
}

function compareByGenderAndCode(
  a: { gender: StudentGender; studentCode: string; room: string },
  b: { gender: StudentGender; studentCode: string; room: string },
  groupByRoom = false
): number {
  if (groupByRoom && a.room !== b.room) {
    return a.room.localeCompare(b.room, 'th', { numeric: true });
  }
  const ga = GENDER_RANK[a.gender];
  const gb = GENDER_RANK[b.gender];
  if (ga !== gb) return ga - gb;
  return compareStudentCodes(a.studentCode, b.studentCode);
}

/**
 * Collapses historical duplicate ScoreRows per (exam_id, student_code) in memory,
 * keeping first-attempt identity (student_name, student_room) and highest score.
 */
export function dedupeBestScores(scores: ScoreRow[]): ScoreRow[] {
  const groups = new Map<string, ScoreRow[]>();
  for (const row of scores) {
    const key = `${row.exam_id}|${row.student_code || row.student_name}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const collapsed: ScoreRow[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      collapsed.push({ ...list[0], attempt_count: list[0].attempt_count ?? 1 });
      continue;
    }

    const byEarliest = [...list].sort(
      (a, b) => (Date.parse(a.submitted_at) || 0) - (Date.parse(b.submitted_at) || 0)
    );
    const first = byEarliest[0];

    const byBest = [...list].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (Date.parse(a.submitted_at) || 0) - (Date.parse(b.submitted_at) || 0);
    });
    const best = byBest[0];

    collapsed.push({
      ...best,
      grade: first.grade,
      student_name: first.student_name,
      student_room: first.student_room,
      attempt_count: Math.max(best.attempt_count ?? 1, list.length),
    });
  }
  return collapsed;
}

export function getRoomsForGrade(
  grade: string,
  roster: StudentRosterRow[],
  scores: ScoreRow[]
): string[] {
  const rooms = new Set<string>();
  for (const st of roster) {
    if ((st.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') continue;
    if (extractGradeFromText(st.grade_level || st.classroom_id) !== grade) continue;
    const room = extractRoomFromStudent(st);
    if (room) rooms.add(room);
  }
  // Include rooms seen in scores only if no roster rooms exist for that grade
  if (rooms.size === 0) {
    for (const sc of scores) {
      if (extractGradeFromText(sc.student_room || sc.grade) === grade && sc.student_room) {
        rooms.add(sc.student_room.trim());
      }
    }
  }
  return Array.from(rooms).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
}

function buildRosterLookup(roster: StudentRosterRow[]): Map<string, StudentRosterRow> {
  const map = new Map<string, StudentRosterRow>();
  for (const st of roster) {
    if (!st.student_id) continue;
    map.set(st.student_id.trim(), st);
  }
  return map;
}

export interface BuildClassReportOptions {
  grade: string;
  examId: string;
  roomFilter?: string;
  groupByRoom?: boolean;
  includeUnsubmitted?: boolean;
  roster: StudentRosterRow[];
  scores: ScoreRow[];
}

export function buildClassScoreReport(opts: BuildClassReportOptions): ClassReportRow[] {
  const {
    grade,
    examId,
    roomFilter = 'ALL',
    groupByRoom = false,
    includeUnsubmitted = true,
    roster,
    scores,
  } = opts;

  if (!examId) return [];

  const rosterByCode = buildRosterLookup(roster);
  const dedupedScores = dedupeBestScores(scores.filter((s) => s.exam_id === examId));
  const scoreByCode = new Map<string, ScoreRow>();
  for (const sc of dedupedScores) {
    if (sc.student_code) scoreByCode.set(sc.student_code.trim(), sc);
  }

  const matchedCodes = new Set<string>();
  const rows: ClassReportRow[] = [];

  for (const st of roster) {
    if ((st.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') continue;
    if (extractGradeFromText(st.grade_level || st.classroom_id) !== grade) continue;

    const room = extractRoomFromStudent(st);
    if (roomFilter !== 'ALL' && room !== roomFilter) continue;

    const code = st.student_id.trim();
    const sc = scoreByCode.get(code);
    if (sc) matchedCodes.add(code);
    if (!includeUnsubmitted && !sc) continue;

    const gender = detectGender(st.title_prefix, sc?.student_name);
    rows.push({
      studentCode: code,
      gender,
      genderLabel: GENDER_LABEL[gender],
      titlePrefix: (st.title_prefix || '').trim(),
      fullName: formatStudentFullName(st.title_prefix, st.name),
      enteredName: sc?.student_name || '',
      room,
      enteredRoom: sc?.student_room || '',
      seatNumber: st.seat_number ?? null,
      inRoster: true,
      crossGrade: false,
      status: sc ? 'submitted' : 'not_submitted',
      score: sc ? sc.score : null,
      maxScore: sc ? sc.max_score : null,
      percentage: sc ? Number(sc.percentage) : null,
      attemptCount: sc ? sc.attempt_count ?? 1 : 0,
      timeSpentSec: sc ? sc.time_spent_sec : null,
      submittedAt: sc ? sc.submitted_at : null,
    });
  }

  // Keep any submitter for this exam who is not in this grade's active roster (e.g. test ID or cross-grade student)
  for (const sc of dedupedScores) {
    const code = (sc.student_code || '').trim();
    if (code && matchedCodes.has(code)) continue;

    const rosterEntry = code ? rosterByCode.get(code) : undefined;
    const room = rosterEntry ? extractRoomFromStudent(rosterEntry) : (sc.student_room || '').trim();
    if (roomFilter !== 'ALL' && room !== roomFilter) continue;

    const titlePrefix = (rosterEntry?.title_prefix || '').trim();
    const fullName = rosterEntry
      ? formatStudentFullName(rosterEntry.title_prefix, rosterEntry.name)
      : sc.student_name;
    const gender = detectGender(titlePrefix, sc.student_name);

    rows.push({
      studentCode: code || sc.student_name,
      gender,
      genderLabel: GENDER_LABEL[gender],
      titlePrefix,
      fullName,
      enteredName: sc.student_name,
      room,
      enteredRoom: sc.student_room,
      seatNumber: rosterEntry?.seat_number ?? null,
      inRoster: Boolean(rosterEntry),
      crossGrade: Boolean(rosterEntry),
      status: 'submitted',
      score: sc.score,
      maxScore: sc.max_score,
      percentage: Number(sc.percentage),
      attemptCount: sc.attempt_count ?? 1,
      timeSpentSec: sc.time_spent_sec,
      submittedAt: sc.submitted_at,
    });
  }

  return rows.sort((a, b) => compareByGenderAndCode(a, b, groupByRoom));
}

export interface BuildGainScoreOptions {
  gradeFilter?: string;
  roomFilter?: string;
  groupByRoom?: boolean;
  roster: StudentRosterRow[];
  scores: ScoreRow[];
}

export function buildGainScoreRows(opts: BuildGainScoreOptions): GainReportRow[] {
  const {
    gradeFilter = 'ALL',
    roomFilter = 'ALL',
    groupByRoom = false,
    roster,
    scores,
  } = opts;

  const rosterByCode = buildRosterLookup(roster);
  const deduped = dedupeBestScores(scores);
  const map = new Map<string, GainReportRow>();

  for (const s of deduped) {
    const m = s.exam_id.match(/^(?:(M[1-3])_)?P(\d{2})_(PRE|POST)$/);
    if (!m) continue;

    const examGrade = m[1]
      ? m[1] === 'M1'
        ? 'ม.1'
        : m[1] === 'M2'
        ? 'ม.2'
        : 'ม.3'
      : s.grade || 'ม.2';

    const code = (s.student_code || '').trim();
    const rosterEntry = code ? rosterByCode.get(code) : undefined;
    const room = rosterEntry ? extractRoomFromStudent(rosterEntry) : (s.student_room || '').trim();

    if (gradeFilter !== 'ALL' && examGrade !== gradeFilter) continue;
    if (roomFilter !== 'ALL' && room !== roomFilter) continue;

    const planNo = parseInt(m[2], 10);
    const key = `${examGrade}|${code || s.student_name}|${planNo}`;
    let entry = map.get(key);

    if (!entry) {
      const gender = detectGender(rosterEntry?.title_prefix, s.student_name);
      const fullName = rosterEntry
        ? formatStudentFullName(rosterEntry.title_prefix, rosterEntry.name)
        : s.student_name;
      entry = {
        grade: examGrade,
        studentCode: code || s.student_name,
        gender,
        genderLabel: GENDER_LABEL[gender],
        fullName,
        room,
        planNo,
        pre: null,
        post: null,
        gain: null,
      };
      map.set(key, entry);
    }

    if (m[3] === 'PRE') {
      entry.pre = entry.pre === null ? s.score : Math.max(entry.pre, s.score);
    } else {
      entry.post = entry.post === null ? s.score : Math.max(entry.post, s.score);
    }
    entry.gain = entry.pre !== null && entry.post !== null ? entry.post - entry.pre : null;
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, 'th');
    const cmp = compareByGenderAndCode(a, b, groupByRoom);
    if (cmp !== 0) return cmp;
    return a.planNo - b.planNo;
  });
}

function escapeCsvCell(value: string | number | null | undefined, neutralizeFormula = false): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let str = String(value);
  if (neutralizeFormula && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function formatThaiTimestamp(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function buildScoreReportCsv(
  rows: ClassReportRow[],
  meta: { examId: string; examTitle: string }
): string {
  const header = [
    'ลำดับ',
    'รหัสนักเรียน',
    'เพศ',
    'ชื่อ-นามสกุล',
    'ห้องเรียน',
    'เลขที่',
    'รหัสแบบทดสอบ',
    'ชื่อแบบทดสอบ',
    'สถานะ',
    'คะแนนที่ได้',
    'คะแนนเต็ม',
    'ร้อยละ',
    'จำนวนครั้งที่ส่ง',
    'เวลาที่ใช้(วินาที)',
    'วันเวลาที่บันทึกคะแนน',
  ];

  const lines = [
    header.join(','),
    ...rows.map((r, idx) =>
      [
        idx + 1,
        escapeCsvCell(r.studentCode),
        escapeCsvCell(r.genderLabel),
        escapeCsvCell(r.fullName, true),
        escapeCsvCell(r.room, true),
        r.seatNumber ?? '',
        escapeCsvCell(meta.examId),
        escapeCsvCell(meta.examTitle, true),
        escapeCsvCell(r.status === 'submitted' ? 'ส่งแล้ว' : 'ยังไม่สอบ'),
        r.score ?? '',
        r.maxScore ?? '',
        r.percentage ?? '',
        r.attemptCount,
        r.timeSpentSec ?? '',
        escapeCsvCell(formatThaiTimestamp(r.submittedAt)),
      ].join(',')
    ),
  ];

  return '\uFEFF' + lines.join('\r\n');
}

export function buildReportCsvFilename(
  grade: string,
  examId: string,
  roomFilter: string,
  now: Date = new Date()
): string {
  const cleanGrade = (grade || 'ALL').replace(/[^ก-๙a-zA-Z0-9._-]/g, '');
  const cleanExam = (examId || 'exam').replace(/[^a-zA-Z0-9._-]/g, '');
  const rawRoom = roomFilter === 'ALL' ? 'ทั้งหมด' : roomFilter.replace(/\//g, '-');
  const cleanRoom = rawRoom.replace(/[^ก-๙a-zA-Z0-9._-]/g, '');
  const datePart = now.toISOString().slice(0, 10);
  return `scores_${cleanGrade}_${cleanExam}_${cleanRoom}_${datePart}.csv`;
}
