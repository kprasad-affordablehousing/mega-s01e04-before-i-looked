import { readFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { DigestRow, NightResult, ReadNight, RunLine, RunStatus, StatusCounts } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const RETRY_ATTENTION = 3;

// Rows the digest marks: any fail during the night, or 3+ retries.
export function needsAttention(row: DigestRow): boolean {
  return row.failures > 0 || row.retries >= RETRY_ATTENTION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

// Returns null when the line is not a valid RunLine.
export function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  if (!isRecord(value)) return null;
  const { at, job, status, owner, error } = value;
  if (typeof at !== 'string' || !TIMESTAMP.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job.length === 0) return null;
  if (!isStatus(status)) return null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  return error === undefined ? { at, job, status, owner } : { at, job, status, owner, error };
}

type Entry = { line: RunLine; time: number; index: number };

// Later instant wins; equal instants fall back to file order.
function later(a: Entry, b: Entry): boolean {
  return a.time !== b.time ? a.time > b.time : a.index > b.index;
}

type Entries = [Entry, ...Entry[]];

function toRow(entries: Entries): DigestRow {
  let first = entries[0];
  let last = entries[0];
  let lastWithError: Entry | null = null;
  let retries = 0;
  let failures = 0;
  for (const entry of entries) {
    if (later(first, entry)) first = entry;
    if (later(entry, last)) last = entry;
    if (entry.line.error !== undefined && (lastWithError === null || later(entry, lastWithError))) {
      lastWithError = entry;
    }
    if (entry.line.status === 'retry') retries += 1;
    if (entry.line.status === 'fail') failures += 1;
  }
  return {
    job: last.line.job,
    owner: last.line.owner,
    runs: entries.length,
    retries,
    failures,
    lastStatus: last.line.status,
    lastError: lastWithError?.line.error ?? null,
    firstAt: first.line.at,
    lastAt: last.line.at,
  };
}

export function aggregate(night: string, text: string): NightResult {
  const byJob = new Map<string, Entries>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let lines = 0;
  let badLines = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const index = lines;
    lines += 1;
    const line = parseLine(raw);
    if (line === null) {
      badLines += 1;
      continue;
    }
    counts[line.status] += 1;
    const entry: Entry = { line, time: Date.parse(line.at), index };
    const list = byJob.get(line.job);
    if (list === undefined) byJob.set(line.job, [entry]);
    else list.push(entry);
  }
  const rows = [...byJob.values()].map(toRow).sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { kind: 'night', night, rows, lines, badLines, counts };
}

function isMissingFile(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return { kind: 'invalid', night };
  const dir = resolve(runsDir);
  const file = resolve(join(dir, `${night}.jsonl`));
  const rel = relative(dir, file);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.includes('/') || rel.includes('\\')) {
    return { kind: 'invalid', night };
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (isMissingFile(err)) return { kind: 'missing', night };
    throw err;
  }
  return aggregate(night, text);
};
