export interface ExamCatalogRow {
  id: string;
  grade: string;
  category: string;
  order_no: number;
  title: string;
  indicators: string;
  question_count: number;
  time_limit_min: number;
  random_questions: boolean;
  random_choices: boolean;
  allow_retake: boolean;
  max_attempts: number; // 1 = ทำได้ 1 ครั้ง (ห้ามซ้ำ), 2+ = ทำซ้ำได้ (max_attempts - 1) ครั้ง, 0 = ไม่จำกัด
  show_review: boolean;
  has_pin: boolean;
  approved: boolean;
  approved_rooms: string[];
  updated_at: string;
  already_submitted?: boolean;
  attempts_used?: number;
  attempts_remaining?: number | null;
  limit_reached?: boolean;
  previous_result?: {
    score: number;
    max_score: number;
    percentage: number;
  } | null;
}

export interface SanitizedQuestion {
  id: string;
  indicator: string;
  question: string;
  choices: { slot: number; text: string }[];
}

export interface ExamResultPayload {
  success: boolean;
  exam_id: string;
  exam_title: string;
  score: number;
  maxScore: number;
  percentage: number;
  scoreAction?: 'created' | 'update_higher' | 'keep_existing';
  bestScore?: number;
  bestMaxScore?: number;
  bestPercentage?: number;
  attemptsUsed?: number;
  breakdown: Record<string, { correct: number; total: number; percentage: number }>;
  showReview: boolean;
  reviewData: {
    id: string;
    indicator: string;
    question: string;
    studentChoice: string;
    correctChoice: string;
    isCorrect: boolean;
    explanation: string;
  }[];
}

export interface ScoreRow {
  id: string;
  exam_id: string;
  grade: string;
  student_code: string;
  student_name: string;
  student_room: string;
  score: number;
  max_score: number;
  percentage: number;
  time_spent_sec: number;
  submitted_at: string;
  attempt_count?: number;
}

export interface StudentRosterRow {
  id: string;
  student_id: string;
  title_prefix: string | null;
  name: string;
  classroom_id: string | null;
  grade_level: string | null;
  seat_number: number | null;
  status: string | null;
}

export type StudentGender = 'male' | 'female' | 'other';

export interface ClassReportRow {
  studentCode: string;
  gender: StudentGender;
  genderLabel: string;
  titlePrefix: string;
  fullName: string;
  enteredName: string;
  room: string;
  enteredRoom: string;
  seatNumber: number | null;
  inRoster: boolean;
  crossGrade: boolean;
  status: 'submitted' | 'not_submitted';
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  attemptCount: number;
  timeSpentSec: number | null;
  submittedAt: string | null;
}

export interface SessionMonitorRow {
  id: string;
  exam_id: string;
  grade: string;
  student_code: string;
  student_name: string;
  student_room: string;
  status: string;
  started_at: string;
}
