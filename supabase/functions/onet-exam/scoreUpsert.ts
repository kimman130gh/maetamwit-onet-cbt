export interface ExistingScoreRecord {
  id: string;
  session_id: string | null;
  student_name: string;
  student_room: string;
  grade: string;
  score: number;
  max_score: number;
  percentage: number;
  submitted_at: string;
}

export interface IncomingScoreInput {
  sessionId: string;
  grade: string;
  studentName: string;
  studentRoom: string;
  score: number;
  maxScore: number;
  percentage: number;
  timeSpentSec: number;
  indicatorBreakdown: Record<string, { correct: number; total: number; percentage: number }>;
  answersJson: Record<string, number>;
  attemptCount: number;
  submittedAt: string;
}

export type ScoreWriteDecision =
  | {
      kind: 'insert';
      record: {
        session_id: string;
        grade: string;
        student_name: string;
        student_room: string;
        score: number;
        max_score: number;
        percentage: number;
        time_spent_sec: number;
        indicator_breakdown: Record<string, { correct: number; total: number; percentage: number }>;
        answers_json: Record<string, number>;
        attempt_count: number;
        submitted_at: string;
      };
      bestScore: number;
      bestMaxScore: number;
      bestPercentage: number;
    }
  | {
      kind: 'update_higher';
      targetId: string;
      dedupeIds: string[];
      patch: {
        session_id: string;
        grade: string;
        student_name: string;
        student_room: string;
        score: number;
        max_score: number;
        percentage: number;
        time_spent_sec: number;
        indicator_breakdown: Record<string, { correct: number; total: number; percentage: number }>;
        answers_json: Record<string, number>;
        attempt_count: number;
        submitted_at: string;
      };
      bestScore: number;
      bestMaxScore: number;
      bestPercentage: number;
    }
  | {
      kind: 'keep_existing';
      targetId: string;
      dedupeIds: string[];
      patch: {
        grade: string;
        student_name: string;
        student_room: string;
        attempt_count: number;
      };
      bestScore: number;
      bestMaxScore: number;
      bestPercentage: number;
    };

function compareSubmittedAsc(a: ExistingScoreRecord, b: ExistingScoreRecord): number {
  const ta = Date.parse(a.submitted_at) || 0;
  const tb = Date.parse(b.submitted_at) || 0;
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

/**
 * Decides how to persist a score submission for a (exam_id, student_code) pair:
 * - First attempt: insert new row with the student's first-attempt name & room.
 * - Retake: locate existing row(s), preserve first-attempt identity, and only
 *   overwrite score/answers/session when the new score is strictly higher.
 */
export function decideScoreWrite(
  existingRows: ExistingScoreRecord[],
  incoming: IncomingScoreInput
): ScoreWriteDecision {
  if (existingRows.length === 0) {
    return {
      kind: 'insert',
      record: {
        session_id: incoming.sessionId,
        grade: incoming.grade,
        student_name: incoming.studentName,
        student_room: incoming.studentRoom,
        score: incoming.score,
        max_score: incoming.maxScore,
        percentage: incoming.percentage,
        time_spent_sec: incoming.timeSpentSec,
        indicator_breakdown: incoming.indicatorBreakdown,
        answers_json: incoming.answersJson,
        attempt_count: incoming.attemptCount,
        submitted_at: incoming.submittedAt,
      },
      bestScore: incoming.score,
      bestMaxScore: incoming.maxScore,
      bestPercentage: incoming.percentage,
    };
  }

  const byEarliest = [...existingRows].sort(compareSubmittedAsc);
  const firstRow = byEarliest[0];

  const byBest = [...existingRows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return compareSubmittedAsc(a, b);
  });
  const bestRow = byBest[0];
  const dedupeIds = existingRows.filter((r) => r.id !== bestRow.id).map((r) => r.id);

  if (incoming.score > bestRow.score) {
    return {
      kind: 'update_higher',
      targetId: bestRow.id,
      dedupeIds,
      patch: {
        session_id: incoming.sessionId,
        grade: firstRow.grade,
        student_name: firstRow.student_name,
        student_room: firstRow.student_room,
        score: incoming.score,
        max_score: incoming.maxScore,
        percentage: incoming.percentage,
        time_spent_sec: incoming.timeSpentSec,
        indicator_breakdown: incoming.indicatorBreakdown,
        answers_json: incoming.answersJson,
        attempt_count: incoming.attemptCount,
        submitted_at: incoming.submittedAt,
      },
      bestScore: incoming.score,
      bestMaxScore: incoming.maxScore,
      bestPercentage: incoming.percentage,
    };
  }

  return {
    kind: 'keep_existing',
    targetId: bestRow.id,
    dedupeIds,
    patch: {
      grade: firstRow.grade,
      student_name: firstRow.student_name,
      student_room: firstRow.student_room,
      attempt_count: incoming.attemptCount,
    },
    bestScore: bestRow.score,
    bestMaxScore: bestRow.max_score,
    bestPercentage: Number(bestRow.percentage),
  };
}
