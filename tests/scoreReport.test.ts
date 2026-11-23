import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClassScoreReport,
  buildGainScoreRows,
  buildReportCsvFilename,
  buildScoreReportCsv,
  detectGender,
  extractGradeFromText,
  extractRoomFromStudent,
  getRoomsForGrade,
} from '../src/lib/scoreReport.ts';
import type { ScoreRow, StudentRosterRow } from '../src/types.ts';

const SAMPLE_ROSTER: StudentRosterRow[] = [
  {
    id: 's1',
    student_id: '03200',
    title_prefix: 'ด.ญ.',
    name: 'มานี มีใจ',
    classroom_id: 'CLS_M2_1',
    grade_level: 'มัธยมศึกษาปีที่ 2/1',
    seat_number: 10,
    status: 'ACTIVE',
  },
  {
    id: 's2',
    student_id: '03105',
    title_prefix: 'ด.ช.',
    name: 'สมชาย ใจดี',
    classroom_id: 'CLS_M2_2',
    grade_level: 'มัธยมศึกษาปีที่ 2/2',
    seat_number: 2,
    status: 'ACTIVE',
  },
  {
    id: 's3',
    student_id: '03101',
    title_prefix: 'ด.ช.',
    name: 'กิตติ รักเรียน',
    classroom_id: 'CLS_M2_1',
    grade_level: 'มัธยมศึกษาปีที่ 2/1',
    seat_number: 1,
    status: 'ACTIVE',
  },
  {
    id: 's4',
    student_id: '03102',
    title_prefix: 'ด.ญ.',
    name: 'สุดา ฟ้าใส',
    classroom_id: 'CLS_M2_2',
    grade_level: 'มัธยมศึกษาปีที่ 2/2',
    seat_number: 8,
    status: 'ACTIVE',
  },
  {
    id: 's5',
    student_id: '03301',
    title_prefix: 'นาย',
    name: 'วิทยา ม.4',
    classroom_id: 'CLS_M4_1',
    grade_level: 'มัธยมศึกษาปีที่ 4/1',
    seat_number: 1,
    status: 'ACTIVE',
  },
  {
    id: 's6',
    student_id: '03099',
    title_prefix: 'ด.ช.',
    name: 'นักเรียนย้ายออก',
    classroom_id: 'CLS_M2_1',
    grade_level: 'มัธยมศึกษาปีที่ 2/1',
    seat_number: 99,
    status: 'INACTIVE',
  },
];

const SAMPLE_SCORES: ScoreRow[] = [
  // s2 typed name without prefix & wrong room ม.2/1 instead of ม.2/2, submitted twice
  {
    id: 'sc1',
    exam_id: 'P01_PRE',
    grade: 'ม.2',
    student_code: '03105',
    student_name: 'สมชาย',
    student_room: 'ม.2/1',
    score: 5,
    max_score: 10,
    percentage: 50,
    time_spent_sec: 100,
    submitted_at: '2026-11-20T02:00:00.000Z',
  },
  {
    id: 'sc2',
    exam_id: 'P01_PRE',
    grade: 'ม.2',
    student_code: '03105',
    student_name: 'ชื่อเปลี่ยนรอบสอง',
    student_room: 'ม.2/1',
    score: 8,
    max_score: 10,
    percentage: 80,
    time_spent_sec: 90,
    submitted_at: '2026-11-20T03:00:00.000Z',
  },
  // s1 submitted P01_PRE and P01_POST
  {
    id: 'sc3',
    exam_id: 'P01_PRE',
    grade: 'ม.2',
    student_code: '03200',
    student_name: 'มานี มีใจ',
    student_room: 'ม.2/1',
    score: 6,
    max_score: 10,
    percentage: 60,
    time_spent_sec: 110,
    submitted_at: '2026-11-20T02:30:00.000Z',
  },
  {
    id: 'sc4',
    exam_id: 'P01_POST',
    grade: 'ม.2',
    student_code: '03200',
    student_name: 'ด.ญ.มานี',
    student_room: 'ม.2/1',
    score: 9,
    max_score: 10,
    percentage: 90,
    time_spent_sec: 95,
    submitted_at: '2026-11-21T02:30:00.000Z',
  },
  // s5 (M.4 student) or test ID not in M.2 roster took P01_PRE
  {
    id: 'sc5',
    exam_id: 'P01_PRE',
    grade: 'ม.2',
    student_code: '99999',
    student_name: 'บัญชีทดสอบ',
    student_room: 'ม.2/1',
    score: 10,
    max_score: 10,
    percentage: 100,
    time_spent_sec: 45,
    submitted_at: '2026-11-20T01:00:00.000Z',
  },
];

describe('grade, room, and gender helpers', () => {
  it('extracts grade and room cleanly from Thai strings and classroom_id', () => {
    assert.equal(extractGradeFromText('มัธยมศึกษาปีที่ 1/2'), 'ม.1');
    assert.equal(extractGradeFromText('CLS_M3_1'), 'ม.3');
    assert.equal(extractRoomFromStudent(SAMPLE_ROSTER[0]), 'ม.2/1');
    assert.equal(
      extractRoomFromStudent({
        ...SAMPLE_ROSTER[0],
        grade_level: null,
        classroom_id: 'CLS_M1_2',
      }),
      'ม.1/2'
    );
  });

  it('detects male, female, and other prefixes accurately', () => {
    assert.equal(detectGender('ด.ช.', ''), 'male');
    assert.equal(detectGender('นาย', ''), 'male');
    assert.equal(detectGender('ด.ญ.', ''), 'female');
    assert.equal(detectGender('น.ส.', ''), 'female');
    assert.equal(detectGender('', 'นางสาวสมหญิง'), 'female');
    assert.equal(detectGender('', 'สมชาย ไม่มีคำนำหน้า'), 'other');
  });

  it('collects sorted dynamic room list per grade from roster and scores', () => {
    assert.deepEqual(getRoomsForGrade('ม.2', SAMPLE_ROSTER, SAMPLE_SCORES), ['ม.2/1', 'ม.2/2']);
  });
});

describe('buildClassScoreReport', () => {
  it('sorts whole grade Male -> Female -> Student ID (and Other last) using roster gender even when score omits prefix', () => {
    const rows = buildClassScoreReport({
      grade: 'ม.2',
      examId: 'P01_PRE',
      roomFilter: 'ALL',
      includeUnsubmitted: true,
      roster: SAMPLE_ROSTER,
      scores: SAMPLE_SCORES,
    });

    // Expected order:
    // Male: 03101 (unsubmitted), 03105 (submitted best 8/10)
    // Female: 03102 (unsubmitted), 03200 (submitted 6/10)
    // Other (test ID outside roster): 99999 (submitted 10/10)
    assert.deepEqual(
      rows.map((r) => r.studentCode),
      ['03101', '03105', '03102', '03200', '99999']
    );
    assert.equal(rows[1].gender, 'male');
    assert.equal(rows[1].room, 'ม.2/2');
    assert.equal(rows[1].score, 8);
    assert.equal(rows[1].attemptCount, 2);
    assert.equal(rows[1].enteredName, 'สมชาย');
    assert.equal(rows[0].status, 'not_submitted');
    assert.equal(rows[0].score, null);
    assert.equal(rows[4].inRoster, false);
  });

  it('filters to a single room accurately using roster room rather than student-selected wrong room', () => {
    const rows = buildClassScoreReport({
      grade: 'ม.2',
      examId: 'P01_PRE',
      roomFilter: 'ม.2/2',
      includeUnsubmitted: true,
      roster: SAMPLE_ROSTER,
      scores: SAMPLE_SCORES,
    });

    // 03105 belongs to ม.2/2 in roster even though they clicked ม.2/1 at login
    assert.deepEqual(
      rows.map((r) => r.studentCode),
      ['03105', '03102']
    );
  });

  it('can hide unsubmitted students when includeUnsubmitted is false', () => {
    const rows = buildClassScoreReport({
      grade: 'ม.2',
      examId: 'P01_PRE',
      roomFilter: 'ALL',
      includeUnsubmitted: false,
      roster: SAMPLE_ROSTER,
      scores: SAMPLE_SCORES,
    });

    assert.deepEqual(
      rows.map((r) => r.studentCode),
      ['03105', '03200', '99999']
    );
  });

  it('supports grouping by room before Male -> Female -> Student ID', () => {
    const rows = buildClassScoreReport({
      grade: 'ม.2',
      examId: 'P01_PRE',
      roomFilter: 'ALL',
      groupByRoom: true,
      includeUnsubmitted: true,
      roster: SAMPLE_ROSTER,
      scores: SAMPLE_SCORES,
    });

    assert.deepEqual(
      rows.map((r) => `${r.room}:${r.studentCode}`),
      ['ม.2/1:03101', 'ม.2/1:03200', 'ม.2/1:99999', 'ม.2/2:03105', 'ม.2/2:03102']
    );
  });
});

describe('buildGainScoreRows', () => {
  it('pairs Pre-test and Post-test by student_code even when student typed different names', () => {
    const gains = buildGainScoreRows({
      gradeFilter: 'ม.2',
      roomFilter: 'ALL',
      roster: SAMPLE_ROSTER,
      scores: SAMPLE_SCORES,
    });

    assert.equal(gains.length, 3);
    // Male 03105 first, Female 03200 second, Other 99999 third
    assert.equal(gains[0].studentCode, '03105');
    assert.equal(gains[0].pre, 8);
    assert.equal(gains[0].post, null);

    assert.equal(gains[1].studentCode, '03200');
    assert.equal(gains[1].fullName, 'ด.ญ.มานี มีใจ');
    assert.equal(gains[1].pre, 6);
    assert.equal(gains[1].post, 9);
    assert.equal(gains[1].gain, 3);

    assert.equal(gains[2].studentCode, '99999');
    assert.equal(gains[2].pre, 10);
  });
});

describe('CSV export', () => {
  it('builds UTF-8 BOM CSV with safe quoting and neutralization', () => {
    const rows = buildClassScoreReport({
      grade: 'ม.2',
      examId: 'P01_PRE',
      roomFilter: 'ALL',
      includeUnsubmitted: true,
      roster: [
        ...SAMPLE_ROSTER,
        {
          id: 's7',
          student_id: '03999',
          title_prefix: '',
          name: '=CMD("calc")',
          classroom_id: 'CLS_M2_1',
          grade_level: 'มัธยมศึกษาปีที่ 2/1',
          seat_number: 20,
          status: 'ACTIVE',
        },
      ],
      scores: SAMPLE_SCORES,
    });

    const csv = buildScoreReportCsv(rows, {
      examId: 'P01_PRE',
      examTitle: 'แบบทดสอบก่อนเรียน "แผน 1"',
    });

    assert.equal(csv.startsWith('\uFEFF'), true);
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines[0].includes('รหัสนักเรียน,เพศ,ชื่อ-นามสกุล'), true);
    assert.equal(lines.some((l) => l.includes('"' + "'" + '=CMD(""calc"")"')), true);
    assert.equal(lines.some((l) => l.includes('"แบบทดสอบก่อนเรียน ""แผน 1"""')), true);
    assert.equal(
      buildReportCsvFilename('ม.2', 'P01_PRE', 'ALL', new Date('2026-11-23T06:00:00.000Z')),
      'scores_ม.2_P01_PRE_ทั้งหมด_2026-11-23.csv'
    );
  });
});
