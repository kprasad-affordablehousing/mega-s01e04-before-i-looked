import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { needsAttention, readNight } from '../src/digest/read.js';
import type { NightDigest, NightResult } from '../src/digest/types.js';

function digest(result: NightResult): NightDigest {
  if (result.kind !== 'night') throw new Error(`expected a night, got ${result.kind}`);
  return result;
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = digest(readNight('runs', '2026-10-28'));

  it('has five jobs, sorted by job, and one bad line', () => {
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.badLines).toBe(1);
    expect(night.lines).toBe(16);
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps a null owner', () => {
    const row = night.rows.find((r) => r.job === 'digest/render');
    expect(row?.owner).toBeNull();
  });

  it('keeps the logged offset on first and last time', () => {
    const row = night.rows.find((r) => r.job === 'lane/sync');
    expect(row).toMatchObject({
      owner: 'rook',
      runs: 8,
      retries: 1,
      failures: 0,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('marks 3+ retries and any fail, even when the job later succeeded', () => {
    const marked = night.rows.filter(needsAttention).map((r) => r.job);
    expect(marked).toEqual(['fixtures/refresh', 'notes/backup']);
    expect(night.rows.find((r) => r.job === 'fixtures/refresh')).toMatchObject({
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
    });
    expect(night.rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      failures: 1,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });
});

describe('readNight edge cases', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('tells missing, empty and all-bad files apart', () => {
    writeFileSync(join(dir, '2026-01-01.jsonl'), '');
    writeFileSync(join(dir, '2026-01-02.jsonl'), 'not json\n{"job":"x"}\n');
    expect(readNight(dir, '2026-01-03')).toEqual({ kind: 'missing', night: '2026-01-03' });
    const empty = digest(readNight(dir, '2026-01-01'));
    expect(empty).toMatchObject({ rows: [], lines: 0, badLines: 0 });
    const bad = digest(readNight(dir, '2026-01-02'));
    expect(bad).toMatchObject({ rows: [], lines: 2, badLines: 2 });
  });

  it('rejects night ids that could leave the runs dir', () => {
    for (const night of ['../2026-10-28', '..\\x', '2026-10-28/../../etc', '2026-10-28.jsonl', '']) {
      expect(readNight(dir, night).kind).toBe('invalid');
    }
  });

  it('counts lines with a valid JSON shape but bad fields as bad', () => {
    const lines = [
      '{"at":"2026-01-01T01:00:00+02:00","job":"a","status":"ok","owner":null}',
      '{"at":"2026-01-01T01:00:00+02:00","job":"a","status":"done","owner":null}',
      '{"at":"yesterday","job":"a","status":"ok","owner":null}',
      '{"at":"2026-01-01T01:00:00+02:00","job":"a","status":"ok","owner":7}',
      '{"at":"2026-01-01T01:00:00+02:00","job":"a","status":"ok"}',
      '[1,2]',
    ];
    writeFileSync(join(dir, '2026-01-04.jsonl'), lines.join('\r\n') + '\r\n');
    const night = digest(readNight(dir, '2026-01-04'));
    expect(night).toMatchObject({ lines: 6, badLines: 5 });
    expect(night.rows).toHaveLength(1);
  });

  it('orders by instant, not by file order or offset text', () => {
    const lines = [
      '{"at":"2026-01-01T00:30:00Z","job":"b","status":"fail","owner":"y","error":"boom"}',
      '{"at":"2026-01-01T01:00:00+02:00","job":"b","status":"ok","owner":"x"}',
    ];
    writeFileSync(join(dir, '2026-01-05.jsonl'), lines.join('\n'));
    const [row] = digest(readNight(dir, '2026-01-05')).rows;
    expect(row).toMatchObject({
      owner: 'y',
      lastStatus: 'fail',
      lastError: 'boom',
      firstAt: '2026-01-01T01:00:00+02:00',
      lastAt: '2026-01-01T00:30:00Z',
    });
  });

  it('propagates filesystem errors other than a missing file', () => {
    mkdirSync(join(dir, '2026-01-06.jsonl'));
    expect(() => readNight(dir, '2026-01-06')).toThrow();
  });
});
