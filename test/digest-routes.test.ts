import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { NightDigest } from '../src/digest/types.js';

const dash = '—';

const realConfig: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'runs',
};

type HtmlRow = { warn: boolean; cells: string[] };

// Rows of the digest table body, in document order. Cell text is the raw HTML inside <td>.
function htmlRows(html: string): HtmlRow[] {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  return [...body.matchAll(/<tr(?: class="([^"]*)")?>([\s\S]*?)<\/tr>/g)].map((m) => ({
    warn: m[1] === 'warn',
    cells: [...(m[2] ?? '').matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1] ?? ''),
  }));
}

// The job cell prefixes flagged rows with a warning sign; strip it to get the job identity.
function jobOf(row: HtmlRow): string {
  return (row.cells[0] ?? '').replace('⚠ ', '');
}

function nightFixture(lines: string[]): string {
  return lines.join('\n') + '\n';
}

describe('digest routes on runs/2026-10-28.jsonl', () => {
  it('answers 200 on the page and on the JSON', async () => {
    const app = createApp(realConfig);
    const page = await app.request('/digest/2026-10-28');
    const json = await app.request('/api/digest/2026-10-28');
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
  });

  it('renders the same jobs in the same order in HTML and JSON', async () => {
    const app = createApp(realConfig);
    const html = await (await app.request('/digest/2026-10-28')).text();
    const body = (await (await app.request('/api/digest/2026-10-28')).json()) as NightDigest;
    const rows = htmlRows(html);
    expect(rows.map(jobOf)).toEqual(body.rows.map((r) => r.job));
    expect(rows.map(jobOf)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('keeps the null-owner job as an em dash and shows the bad line', async () => {
    const app = createApp(realConfig);
    const html = await (await app.request('/digest/2026-10-28')).text();
    const row = htmlRows(html).find((r) => jobOf(r) === 'digest/render');
    expect(row?.cells[1]).toBe(dash);
    expect(html).toContain('1 bad line(s) skipped');
  });

  it('marks the retry-3 job and the job with a fail that later recovered', async () => {
    const app = createApp(realConfig);
    const html = await (await app.request('/digest/2026-10-28')).text();
    const rows = htmlRows(html);
    expect(rows.filter((r) => r.warn).map(jobOf)).toEqual(['fixtures/refresh', 'notes/backup']);
    const refresh = rows.find((r) => jobOf(r) === 'fixtures/refresh');
    expect(refresh?.cells.slice(1, 7)).toEqual(['rook', '4', '3', '0', 'ok', 'upstream 503']);
  });

  it('keeps the logged offset strings in HTML and JSON', async () => {
    const app = createApp(realConfig);
    const html = await (await app.request('/digest/2026-10-28')).text();
    const body = (await (await app.request('/api/digest/2026-10-28')).json()) as NightDigest;
    const row = htmlRows(html).find((r) => jobOf(r) === 'lane/sync');
    expect(row?.cells[7]).toBe('2026-10-28T23:00:06+01:00');
    expect(row?.cells[8]).toBe('2026-10-29T05:00:04+01:00');
    const json = body.rows.find((r) => r.job === 'lane/sync');
    expect(json).toMatchObject({
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });
});

describe('digest routes on temporary runs directories', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function appFor(): ReturnType<typeof createApp> {
    return createApp({ ...realConfig, runsDir: dir });
  }

  function night(name: string, lines: string[]): void {
    writeFileSync(join(dir, `${name}.jsonl`), nightFixture(lines));
  }

  it('returns 404 for a night with no file, in HTML and JSON', async () => {
    const app = appFor();
    const page = await app.request('/digest/2026-02-02');
    const json = await app.request('/api/digest/2026-02-02');
    expect(page.status).toBe(404);
    expect(json.status).toBe(404);
  });

  it('returns 404 for an invalid night identifier', async () => {
    const app = appFor();
    expect((await app.request('/digest/..%2Fsecret')).status).toBe(404);
    expect((await app.request('/api/digest/2026-02-02.jsonl')).status).toBe(404);
  });

  it('says nothing ran for an empty night, and JSON has no rows', async () => {
    night('2026-02-03', []);
    const app = appFor();
    const html = await (await app.request('/digest/2026-02-03')).text();
    const body = (await (await app.request('/api/digest/2026-02-03')).json()) as NightDigest;
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table>');
    expect(body).toMatchObject({ kind: 'night', rows: [], lines: 0, badLines: 0 });
  });

  it('keeps valid rows when one line is bad, and counts the bad line', async () => {
    night('2026-02-04', [
      '{"at":"2026-02-04T01:00:00+01:00","job":"a","status":"ok","owner":"rook"}',
      'not json at all',
      '{"at":"2026-02-04T02:00:00+01:00","job":"b","status":"ok","owner":"rook"}',
    ]);
    const app = appFor();
    const html = await (await app.request('/digest/2026-02-04')).text();
    const body = (await (await app.request('/api/digest/2026-02-04')).json()) as NightDigest;
    expect(html).toContain('1 bad line(s) skipped');
    expect(htmlRows(html).map(jobOf)).toEqual(['a', 'b']);
    expect(body).toMatchObject({ lines: 3, badLines: 1 });
    expect(body.rows.map((r) => r.job)).toEqual(['a', 'b']);
  });

  it('does not claim nothing ran for a night with only bad lines', async () => {
    night('2026-02-05', ['garbage', '{"job":"x"}']);
    const app = appFor();
    const html = await (await app.request('/digest/2026-02-05')).text();
    const body = (await (await app.request('/api/digest/2026-02-05')).json()) as NightDigest;
    expect(html).not.toContain('nothing ran');
    expect(html).toContain('2 bad line(s) skipped');
    expect(body).toMatchObject({ lines: 2, badLines: 2, rows: [] });
  });

  it('sorts jobs identically in HTML and JSON, and keeps a null owner row', async () => {
    night('2026-02-06', [
      '{"at":"2026-02-06T01:00:00+01:00","job":"zeta","status":"ok","owner":"rook"}',
      '{"at":"2026-02-06T01:01:00+01:00","job":"Mid","status":"ok","owner":null}',
      '{"at":"2026-02-06T01:02:00+01:00","job":"alpha","status":"ok","owner":"rook"}',
    ]);
    const app = appFor();
    const html = await (await app.request('/digest/2026-02-06')).text();
    const body = (await (await app.request('/api/digest/2026-02-06')).json()) as NightDigest;
    const rows = htmlRows(html);
    expect(rows.map(jobOf)).toEqual(['Mid', 'alpha', 'zeta']);
    expect(body.rows.map((r) => r.job)).toEqual(['Mid', 'alpha', 'zeta']);
    expect(rows[0]?.cells[1]).toBe(dash);
    expect(body.rows[0]?.owner).toBeNull();
  });

  it('keeps original offsets, including Z, in HTML and JSON', async () => {
    night('2026-02-07', [
      '{"at":"2026-02-07T00:30:00Z","job":"b","status":"fail","owner":"y","error":"boom"}',
      '{"at":"2026-02-07T01:00:00+02:00","job":"b","status":"ok","owner":"x"}',
    ]);
    const app = appFor();
    const html = await (await app.request('/digest/2026-02-07')).text();
    const body = (await (await app.request('/api/digest/2026-02-07')).json()) as NightDigest;
    const row = htmlRows(html)[0];
    expect(row?.cells[7]).toBe('2026-02-07T01:00:00+02:00');
    expect(row?.cells[8]).toBe('2026-02-07T00:30:00Z');
    expect(body.rows[0]).toMatchObject({
      firstAt: '2026-02-07T01:00:00+02:00',
      lastAt: '2026-02-07T00:30:00Z',
    });
  });

  it('marks exactly three retries, but not two', async () => {
    const retry = (job: string, minute: number): string =>
      `{"at":"2026-02-08T01:${String(minute).padStart(2, '0')}:00+01:00","job":"${job}","status":"retry","owner":"rook","error":"503"}`;
    night('2026-02-08', [
      retry('three', 0),
      retry('three', 1),
      retry('three', 2),
      retry('two', 0),
      retry('two', 1),
    ]);
    const app = appFor();
    const html = await (await app.request('/digest/2026-02-08')).text();
    const body = (await (await app.request('/api/digest/2026-02-08')).json()) as NightDigest;
    const rows = htmlRows(html);
    expect(rows.find((r) => jobOf(r) === 'three')?.warn).toBe(true);
    expect(rows.find((r) => jobOf(r) === 'two')?.warn).toBe(false);
    expect(body.rows.find((r) => r.job === 'three')?.retries).toBe(3);
    expect(body.rows.find((r) => r.job === 'two')?.retries).toBe(2);
  });

  it('still marks a job whose fail was later recovered', async () => {
    night('2026-02-09', [
      '{"at":"2026-02-09T01:00:00+01:00","job":"flaky","status":"fail","owner":"rook","error":"quota"}',
      '{"at":"2026-02-09T02:00:00+01:00","job":"flaky","status":"ok","owner":"rook"}',
    ]);
    const app = appFor();
    const html = await (await app.request('/digest/2026-02-09')).text();
    const body = (await (await app.request('/api/digest/2026-02-09')).json()) as NightDigest;
    const row = htmlRows(html)[0];
    expect(row?.warn).toBe(true);
    expect(row?.cells.slice(2, 7)).toEqual(['2', '0', '1', 'ok', 'quota']);
    expect(body.rows[0]).toMatchObject({ failures: 1, lastStatus: 'ok', lastError: 'quota' });
  });
});

describe('status board digest links', () => {
  it('links each night on disk to its digest with its counts', async () => {
    const html = await (await createApp(realConfig).request('/')).text();
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('ok 10 · retry 4 · fail 1');
    expect(html).toContain('ok 7 · retry 0 · fail 0');
  });

  it('links every digest the board shows to a page that renders', async () => {
    const app = createApp(realConfig);
    const html = await (await app.request('/')).text();
    const links = [...html.matchAll(/href="(\/digest\/\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1] ?? '');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect((await app.request(link)).status).toBe(200);
    }
  });
});
