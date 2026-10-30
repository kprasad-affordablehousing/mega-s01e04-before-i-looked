import type { NightResult } from '../digest/types.js';
import { needsAttention } from '../digest/read.js';

const dash = '—';

export function DigestView({ result }: { result: Extract<NightResult, { kind: 'night' }> }) {
  return (
    <section>
      <h1>Digest {result.night}</h1>
      {result.lines === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <>
          {result.badLines > 0 && (
            <p class="warn">{result.badLines} bad line(s) skipped</p>
          )}
          <table>
            <thead>
              <tr>
                <th>job</th>
                <th>owner</th>
                <th>runs</th>
                <th>retries</th>
                <th>failures</th>
                <th>last status</th>
                <th>last error</th>
                <th>first at</th>
                <th>last at</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr class={needsAttention(row) ? 'warn' : undefined}>
                  <td>{needsAttention(row) ? '⚠ ' : ''}{row.job}</td>
                  <td>{row.owner ?? dash}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.failures}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? dash}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
