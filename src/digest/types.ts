// Contract for the morning digest (plan.md section 1).
// The reader lives in src/digest/read.ts and exports `readNight: ReadNight`.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One validated line of runs/<night>.jsonl.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times are the `at` strings exactly as logged (offset kept).
export type DigestRow = {
  job: string;
  // Owner of the job's latest line; null is kept, never dropped.
  owner: string | null;
  // Valid lines for this job.
  runs: number;
  // Lines with status "retry".
  retries: number;
  // Lines with status "fail", even if a later line succeeded.
  failures: number;
  // Status of the job's latest line.
  lastStatus: RunStatus;
  // Most recent `error` seen for the job, or null if none was logged.
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type StatusCounts = Record<RunStatus, number>;

export type NightDigest = {
  kind: 'night';
  night: string;
  // Sorted by job (code-unit order).
  rows: DigestRow[];
  // Non-blank lines in the file (valid + bad). 0 means the file is empty.
  lines: number;
  // Lines that did not parse or did not match RunLine.
  badLines: number;
  // Valid lines by status.
  counts: StatusCounts;
};

// No runs/<night>.jsonl on disk.
export type NightMissing = { kind: 'missing'; night: string };

// The night identifier is not YYYY-MM-DD (never touches the filesystem).
export type NightInvalid = { kind: 'invalid'; night: string };

export type NightResult = NightDigest | NightMissing | NightInvalid;

// Synchronous. Throws on filesystem errors other than a missing file.
export type ReadNight = (runsDir: string, night: string) => NightResult;
