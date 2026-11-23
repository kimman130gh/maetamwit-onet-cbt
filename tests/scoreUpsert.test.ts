import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'npm:@supabase/supabase-js@2' || specifier === 'jsr:@supabase/supabase-js@2/cors') {
      return { shortCircuit: true, url: `stub://${specifier}` };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'stub://npm:@supabase/supabase-js@2') {
      return {
        shortCircuit: true,
        format: 'module',
        source: 'export function createClient() { return {}; }',
      };
    }
    if (url === 'stub://jsr:@supabase/supabase-js@2/cors') {
      return {
        shortCircuit: true,
        format: 'module',
        source: 'export const corsHeaders = {};',
      };
    }
    return nextLoad(url, context);
  },
});

const { decideScoreWrite } = await import('../supabase/functions/onet-exam/index.ts');
import type { ExistingScoreRecord, IncomingScoreInput } from '../supabase/functions/onet-exam/index.ts';

function makeIncoming(overrides: Partial<IncomingScoreInput> = {}): IncomingScoreInput {
  return {
    sessionId: 'sess-new',
    grade: 'ม.2',
    studentName: 'ชื่อใหม่ ไม่ใส่คำนำหน้า',
    studentRoom: 'ม.2/2',
    score: 8,
    maxScore: 10,
    percentage: 80,
    timeSpentSec: 120,
    indicatorBreakdown: { 'ว 4.1 ม.2/1': { correct: 8, total: 10, percentage: 80 } },
    answersJson: { Q1: 1 },
    attemptCount: 2,
    submittedAt: '2026-11-23T06:00:00.000Z',
    ...overrides,
  };
}

describe('decideScoreWrite', () => {
  it('inserts when no existing record exists for (exam_id, student_code)', () => {
    const decision = decideScoreWrite([], makeIncoming({ attemptCount: 1, studentName: 'ด.ช.สมชาย ใจดี' }));
    assert.equal(decision.kind, 'insert');
    if (decision.kind !== 'insert') return;
    assert.equal(decision.record.student_name, 'ด.ช.สมชาย ใจดี');
    assert.equal(decision.record.score, 8);
    assert.equal(decision.record.attempt_count, 1);
    assert.equal(decision.bestScore, 8);
  });

  it('updates score on retake when strictly higher while preserving first-attempt name and room', () => {
    const existing: ExistingScoreRecord[] = [
      {
        id: 'row-1',
        session_id: 'sess-1',
        student_name: 'ด.ช.สมชาย ใจดี',
        student_room: 'ม.2/1',
        grade: 'ม.2',
        score: 6,
        max_score: 10,
        percentage: 60,
        submitted_at: '2026-11-20T03:00:00.000Z',
      },
    ];

    const decision = decideScoreWrite(
      existing,
      makeIncoming({
        sessionId: 'sess-2',
        studentName: 'สมชาย เปลี่ยนชื่อ',
        studentRoom: 'ม.2/5',
        score: 9,
        percentage: 90,
        attemptCount: 2,
      })
    );

    assert.equal(decision.kind, 'update_higher');
    if (decision.kind !== 'update_higher') return;
    assert.equal(decision.targetId, 'row-1');
    assert.deepEqual(decision.dedupeIds, []);
    assert.equal(decision.patch.student_name, 'ด.ช.สมชาย ใจดี');
    assert.equal(decision.patch.student_room, 'ม.2/1');
    assert.equal(decision.patch.score, 9);
    assert.equal(decision.patch.session_id, 'sess-2');
    assert.equal(decision.patch.attempt_count, 2);
    assert.equal(decision.bestScore, 9);
  });

  it('keeps existing score and timestamp when retake score is lower', () => {
    const existing: ExistingScoreRecord[] = [
      {
        id: 'row-1',
        session_id: 'sess-1',
        student_name: 'ด.ญ.มานี มีใจ',
        student_room: 'ม.1/1',
        grade: 'ม.1',
        score: 8,
        max_score: 10,
        percentage: 80,
        submitted_at: '2026-11-20T03:00:00.000Z',
      },
    ];

    const decision = decideScoreWrite(
      existing,
      makeIncoming({
        sessionId: 'sess-2',
        studentName: 'มานี พิมพ์ผิด',
        score: 5,
        percentage: 50,
        attemptCount: 2,
      })
    );

    assert.equal(decision.kind, 'keep_existing');
    if (decision.kind !== 'keep_existing') return;
    assert.equal(decision.targetId, 'row-1');
    assert.equal(decision.patch.student_name, 'ด.ญ.มานี มีใจ');
    assert.equal(decision.patch.attempt_count, 2);
    assert.equal(decision.bestScore, 8);
    assert.equal(decision.bestPercentage, 80);
  });

  it('keeps existing score when retake score is equal', () => {
    const existing: ExistingScoreRecord[] = [
      {
        id: 'row-1',
        session_id: 'sess-1',
        student_name: 'ด.ช.ปิติ',
        student_room: 'ม.3/1',
        grade: 'ม.3',
        score: 7,
        max_score: 10,
        percentage: 70,
        submitted_at: '2026-11-20T03:00:00.000Z',
      },
    ];

    const decision = decideScoreWrite(
      existing,
      makeIncoming({
        score: 7,
        percentage: 70,
        attemptCount: 2,
      })
    );

    assert.equal(decision.kind, 'keep_existing');
    assert.equal(decision.bestScore, 7);
  });

  it('deduplicates multiple pre-migration rows keeping earliest name and highest score', () => {
    const existing: ExistingScoreRecord[] = [
      {
        id: 'row-2',
        session_id: 'sess-2',
        student_name: 'ชื่อรอบสอง',
        student_room: 'ม.2/2',
        grade: 'ม.2',
        score: 9,
        max_score: 10,
        percentage: 90,
        submitted_at: '2026-11-21T04:00:00.000Z',
      },
      {
        id: 'row-1',
        session_id: 'sess-1',
        student_name: 'ด.ช.ชื่อรอบแรก',
        student_room: 'ม.2/1',
        grade: 'ม.2',
        score: 5,
        max_score: 10,
        percentage: 50,
        submitted_at: '2026-11-20T03:00:00.000Z',
      },
    ];

    const decision = decideScoreWrite(existing, makeIncoming({ score: 6, attemptCount: 3 }));
    assert.equal(decision.kind, 'keep_existing');
    if (decision.kind !== 'keep_existing') return;
    assert.equal(decision.targetId, 'row-2');
    assert.deepEqual(decision.dedupeIds, ['row-1']);
    assert.equal(decision.patch.student_name, 'ด.ช.ชื่อรอบแรก');
    assert.equal(decision.patch.student_room, 'ม.2/1');
    assert.equal(decision.bestScore, 9);
  });
});
