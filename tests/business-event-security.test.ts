import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  CallbackValidationError,
  constantTimeEqual,
  parseEventSecret,
  signEventBody,
  validateCallbackUrl,
} from '../src/lib/business-event-security';

// Synthetic fixture bytes 0x00..0x1f, not a live callback or credential.
const SECRET = `whsec_${Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i)).toString('base64')}`;
const BODY = '{ "eventId": "evt_fixture", "data": { "message": "hello 🌍" } }\n';
const ORIGIN = 'https://unit-test-events.chatgpt.com';
const CALLBACK = `${ORIGIN}/fixture/callback-private?token=not-a-real-secret`;

test('event signing matches an independently computed fixed Standard Webhooks HMAC fixture', async () => {
  const expected = 'v1,XiYf5Dg8vgjAthCYk1eX8ZYLiXE1RVp9HkQD+75b4CQ=';
  assert.equal(await signEventBody(SECRET, 'evt_fixture', 1720000000, BODY), expected);
  assert.equal(`v1,${createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64'))
    .update(`evt_fixture.1720000000.${BODY}`, 'utf8').digest('base64')}`, expected);
});

test('signing preserves exact body whitespace, UTF-8, timestamp and event identity', async () => {
  const signature = await signEventBody(SECRET, 'evt_fixture', 1720000000, BODY);
  for (const [id, timestamp, body] of [
    ['evt_fixture', 1720000000, BODY.trim()],
    ['evt_fixture', 1720000000, JSON.stringify(JSON.parse(BODY))],
    ['evt_fixture', 1720000001, BODY],
    ['evt_other', 1720000000, BODY],
    ['evt_fixture', 1720000000, BODY.replace('🌍', '🌎')],
  ] as const) assert.notEqual(await signEventBody(SECRET, id, timestamp, body), signature);
});

test('event secrets accept every supported key size, including both boundaries', () => {
  for (let length = 24; length <= 64; length++) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 17) % 256);
    assert.deepEqual(parseEventSecret(`whsec_${Buffer.from(bytes).toString('base64')}`), bytes);
  }
  const parsed = parseEventSecret(SECRET);
  parsed.fill(0);
  assert.equal(parseEventSecret(SECRET)[31], 31, 'returned bytes must not share mutable state');
});

test('malformed, noncanonical and out-of-bounds secrets fail with a sanitized error', () => {
  const invalid = [
    undefined, null, 123, {}, new String(SECRET), '', 'whsec_', SECRET.slice(6),
    SECRET.replace('whsec_', 'WHSEC_'), SECRET.replace('whsec_', 'whsk_'),
    ` ${SECRET}`, `${SECRET}\n`, SECRET.replace('AAEC', 'AA E'),
    SECRET.replace('AAEC', 'AA-E'), SECRET.replace('AAEC', 'AA_E'),
    SECRET.slice(0, -1), `${SECRET}=`, SECRET.replace('Hh8=', 'Hh9='),
    `whsec_${Buffer.alloc(23).toString('base64')}`,
    `whsec_${Buffer.alloc(65).toString('base64')}`,
    `whsec_${'A'.repeat(100000)}`,
  ];
  for (const value of invalid) {
    assert.throws(() => parseEventSecret(value), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Invalid event signing secret.');
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('signing rejects ambiguous metadata and noninteger Unix timestamps without echoing input', async () => {
  for (const id of ['', 'id.with.dot', 'id\nsecret', 'id secret', 'x'.repeat(257)]) {
    await assert.rejects(signEventBody(SECRET, id, 1720000000, BODY), { message: 'Invalid event signing input.' });
  }
  for (const timestamp of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1720000000' as unknown as number]) {
    await assert.rejects(signEventBody(SECRET, 'evt_fixture', timestamp, BODY), { message: 'Invalid event signing input.' });
  }
  await assert.rejects(signEventBody(SECRET, 'evt_fixture', 1720000000, {} as string), { message: 'Invalid event signing input.' });
  await assert.rejects(signEventBody('secret-must-not-leak', 'evt_fixture', 1720000000, BODY), { message: 'Invalid event signing secret.' });
});

test('constant-time-style comparison is exact for all positions, lengths and Unicode code units', () => {
  for (const value of ['', 'a', 'a\0b', 'challenge-0123456789', '🌍', '\ud800']) {
    assert.equal(constantTimeEqual(value, value), true);
    assert.equal(constantTimeEqual(value, `${value}\0`), false);
    assert.equal(constantTimeEqual(`${value}\0`, value), false);
  }
  for (const pair of [['abcdef', 'xbcdef'], ['abcdef', 'abcxef'], ['abcdef', 'abcdex'],
    ['', '\0'], ['é', 'e\u0301'], ['🌍', '🌎'], ['\ud800', '\ud801']]) {
    assert.equal(constantTimeEqual(pair[0], pair[1]), false);
    assert.equal(constantTimeEqual(pair[1], pair[0]), false);
  }
});

test('callback parsing accepts only the configured origin and preserves callback path and query', () => {
  const url = validateCallbackUrl(CALLBACK, ORIGIN);
  assert.ok(url instanceof URL);
  assert.equal(url.href, CALLBACK);
  assert.equal(url.origin, ORIGIN);
  assert.equal(validateCallbackUrl(`${ORIGIN}:443/fixture`, ORIGIN).origin, ORIGIN);
  assert.equal(validateCallbackUrl(CALLBACK, `${ORIGIN}:443`).origin, ORIGIN);
  assert.equal(validateCallbackUrl(CALLBACK, ORIGIN.toUpperCase()).origin, ORIGIN);
  for (const origin of ['https://chatgpt.com', 'https://openai.com', 'https://unit-test-events.openai.com']) {
    assert.equal(validateCallbackUrl(`${origin}/fixture`, origin).origin, origin);
  }
});

test('unconfigured callback fails closed while exposing only its approved-root candidate origin', () => {
  for (const configured of [undefined, '']) {
    assert.throws(() => validateCallbackUrl(CALLBACK, configured), error => {
      assert.ok(error instanceof CallbackValidationError);
      assert.equal(error.reason, 'callback_origin_not_configured');
      assert.equal(error.candidateOrigin, ORIGIN);
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /callback-private|not-a-real-secret/);
      return true;
    });
  }
});

test('cross-origin callbacks are never permitted by a root or sibling origin', () => {
  for (const configured of ['https://chatgpt.com', 'https://sibling.chatgpt.com', 'https://unit-test-events.openai.com']) {
    assert.throws(() => validateCallbackUrl(CALLBACK, configured), error => {
      assert.ok(error instanceof CallbackValidationError);
      assert.equal(error.reason, 'callback_origin_mismatch');
      assert.equal(error.candidateOrigin, ORIGIN);
      return true;
    });
  }
});

test('configured callback origin must itself be an approved, HTTPS, origin-only value', () => {
  for (const configured of [
    `${ORIGIN}/`, `${ORIGIN}/callback`, `${ORIGIN}?`, `${ORIGIN}?x=y`, `${ORIGIN}#`,
    `${ORIGIN}:8443`, `http://${new URL(ORIGIN).hostname}`, 'https://evil.test',
    'https://chatgpt.site', 'https://localhost', ` ${ORIGIN}`, null,
  ]) {
    assert.throws(() => validateCallbackUrl(CALLBACK, configured as string), error => {
      assert.ok(error instanceof CallbackValidationError);
      assert.equal(error.reason, 'invalid_callback_origin');
      assert.equal(error.candidateOrigin, ORIGIN);
      return true;
    });
  }
});

test('callback guards reject suffix confusion, credentials, IPs, ports and repaired redirect URIs', () => {
  const invalid: unknown[] = [
    undefined, null, 42, {}, new URL(CALLBACK), '', '/fixture', '//unit-test-events.chatgpt.com/fixture',
    'https:unit-test-events.chatgpt.com/fixture', 'https:///unit-test-events.chatgpt.com/fixture',
    'http://unit-test-events.chatgpt.com/fixture', 'ftp://unit-test-events.chatgpt.com/fixture',
    'https://evilchatgpt.com/fixture', 'https://chatgpt.com.evil.test/fixture',
    'https://unit-test-events.chatgpt.site/fixture', 'https://evilopenai.com/fixture',
    'https://openai.com.evil.test/fixture', 'https://unit-test-events.chatgpt.com./fixture',
    'https://foo..chatgpt.com/fixture', 'https://-foo.chatgpt.com/fixture',
    'https://user:password@unit-test-events.chatgpt.com/fixture',
    'https://@unit-test-events.chatgpt.com/fixture',
    'https://unit-test-events.chatgpt.com@evil.test/fixture',
    'https://evil.test@unit-test-events.chatgpt.com/fixture',
    'https://127.0.0.1/fixture', 'https://2130706433/fixture', 'https://0x7f000001/fixture',
    'https://[::1]/fixture', 'https://169.254.169.254/fixture', 'https://localhost/fixture',
    'https://foo.localhost/fixture', 'https://10.0.0.1/fixture', 'https://192.168.1.1/fixture',
    `${ORIGIN}:80/fixture`, `${ORIGIN}:8443/fixture`, `${ORIGIN}:0/fixture`,
    `${CALLBACK}#fragment`, `${CALLBACK}#`, ` ${CALLBACK}`, `${CALLBACK} `,
    'https://%75nit-test-events.chatgpt.com/fixture',
    'https://unit-test-events.chatgpt.com\\@evil.test/fixture',
    `${ORIGIN}/\\evil.test`, `${ORIGIN}/%5cevil.test`, `${ORIGIN}/%255Cevil.test`,
    `${ORIGIN}/path\r\nheader`, `${ORIGIN}/path%0d%0aheader`, `${ORIGIN}/path%250Aheader`,
    `${ORIGIN}/path%00`, `${ORIGIN}/path%7f`, `${ORIGIN}/path%C2%85`,
    `${ORIGIN}/path%C2%85/../fixture`,
    `${ORIGIN}/path%zz`, `${ORIGIN}/path?token=%5c`,
    'https://unit-test-\nevents.chatgpt.com/fixture',
  ];
  for (const value of invalid) {
    assert.throws(() => validateCallbackUrl(value, ORIGIN), error => {
      assert.ok(error instanceof CallbackValidationError);
      assert.equal(error.reason, 'invalid_callback_url');
      assert.equal(error.candidateOrigin, undefined);
      assert.equal(error.message, 'Callback URL is invalid or not permitted.');
      return true;
    });
  }
});

test('URL validation never treats a nested redirect target as the actual callback origin', () => {
  const nested = `${ORIGIN}/fixture?redirect_uri=https%3A%2F%2Fevil.test%2Fcallback`;
  assert.equal(validateCallbackUrl(nested, ORIGIN).origin, ORIGIN);
  assert.throws(() => validateCallbackUrl(`https://evil.test/fixture?redirect_uri=${encodeURIComponent(CALLBACK)}`, ORIGIN), CallbackValidationError);
  // Transport must independently reject redirects; a pure parser performs no network activity.
});

test('typed callback errors cannot expose arbitrary diagnostics or candidate callback secrets', () => {
  const invalid = new CallbackValidationError('secret-must-not-leak' as never, CALLBACK);
  assert.equal(invalid.reason, 'invalid_callback_url');
  assert.equal(invalid.candidateOrigin, undefined);
  assert.doesNotMatch(`${invalid.stack} ${JSON.stringify(invalid)}`, /secret-must-not-leak|callback-private|not-a-real-secret/);
  for (const candidate of ['https://evil.test', `${ORIGIN}/secret`, `${ORIGIN}?secret`, `https://password@${new URL(ORIGIN).hostname}`]) {
    assert.equal(new CallbackValidationError('callback_origin_not_configured', candidate).candidateOrigin, undefined);
  }
});
