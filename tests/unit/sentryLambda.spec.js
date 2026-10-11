import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const { createReporter } = require('../../aws-lambda/sentryLambda.js');

const DSN = 'https://abc@o1.ingest.sentry.io/42';

const fakeFetch = () => {
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push(JSON.parse(init.body.split('\n')[2]));
    return { ok: true };
  };
  return { sent, fetchFn };
};

// 2026-10-11: the talk-through and receipt Lambda logged its failures to
// CloudWatch only, and once rejected every scan for days without anyone being
// told. These pin the three paths that matter to it.
describe('sentryLambda in the scan Lambda', () => {
  it('reports a caught failure that only console.errors (runJob, the 503, the 502)', async () => {
    const { sent, fetchFn } = fakeFetch();
    const handler = createReporter({ dsn: DSN, functionName: 'perishable-vision', fetchFn })
      .wrapHandler(async () => {
        console.error('Job 1234abcd-0000 failed', new Error('No parsed output (stop_reason: max_tokens)'));
        return { ok: true };
      });
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await handler({ jobId: 'x' }, {})).toEqual({ ok: true });
    } finally {
      console.error = quiet;
    }
    expect(sent).toHaveLength(1);
    expect(sent[0].exception.values[0].value).toContain('No parsed output');
    expect(sent[0].tags.function).toBe('perishable-vision');
  });

  it('reports a thrown error and rethrows it', async () => {
    const { sent, fetchFn } = fakeFetch();
    const handler = createReporter({ dsn: DSN, functionName: 'perishable-vision', fetchFn })
      .wrapHandler(async () => { throw new Error('boom'); });
    await expect(handler({}, {})).rejects.toThrow('boom');
    expect(sent[0].tags.handled).toBe('no');
  });

  it('scrubs the Firebase token the key check sends as ?auth=', async () => {
    const { sent, fetchFn } = fakeFetch();
    await createReporter({ dsn: DSN, functionName: 'perishable-vision', fetchFn })
      .captureMessage('GET https://db.example/fridge/k.json?auth=eyJ.secret failed');
    expect(sent[0].message).toContain('?auth=[Filtered]');
    expect(sent[0].message).not.toContain('eyJ');
  });

  it('the deployed handler is the wrapped one', () => {
    const source = readFileSync(new URL('../../aws-lambda/perishable-vision.js', import.meta.url), 'utf8');
    expect(source).toMatch(/exports\.handler = createReporter\(\{[\s\S]*\}\)\.wrapHandler\(exports\.handler\);\s*$/);
  });
});
