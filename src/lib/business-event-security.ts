/**
 * Pure MCP Events guards. This module never contacts a callback or follows a redirect.
 * https://developers.openai.com/plugins/build/mcp-events
 * https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 */

const INVALID_SECRET = 'Invalid event signing secret.';
const OPENAI_ROOTS = ['chatgpt.com', 'openai.com'] as const;
const UNSAFE_URL_TEXT = /[\s\u0000-\u001f\u007f-\u009f\\#]/u;
const UNSAFE_DECODED_TEXT = /[\u0000-\u001f\u007f-\u009f\\]/u;
// Also reject nested percent-encoded ASCII controls and backslashes rather than
// relying on a receiver to decode them only once.
const ENCODED_UNSAFE_TEXT = /%(?:25)*(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i;
const ORIGIN_ONLY = /^https:\/\/[a-z0-9.-]+(?::443)?$/i;

/** Accept only the standard, canonical base64 representation of a 24–64 byte key. */
export function parseEventSecret(secret: unknown): Uint8Array {
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) {
    throw new Error(INVALID_SECRET);
  }
  const encoded = secret.slice(6);
  if (encoded.length < 32 || encoded.length > 88
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(INVALID_SECRET);
  }
  try {
    const decoded = atob(encoded);
    if (decoded.length < 24 || decoded.length > 64 || btoa(decoded) !== encoded) {
      throw new Error(INVALID_SECRET);
    }
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  } catch {
    // Do not include raw input, runtime decoder messages, or a secret-bearing cause.
    throw new Error(INVALID_SECRET);
  }
}

/** Sign the supplied body exactly as UTF-8; callers must send this same string. */
export async function signEventBody(
  secret: string,
  webhookId: string,
  timestamp: number,
  body: string,
): Promise<string> {
  // A dot in ID or timestamp would make the Standard Webhooks envelope ambiguous.
  if (typeof webhookId !== 'string' || webhookId.length === 0 || webhookId.length > 256
    || /[.\s\u0000-\u001f\u007f-\u009f]/u.test(webhookId)
    || !Number.isSafeInteger(timestamp) || timestamp < 0 || typeof body !== 'string') {
    throw new Error('Invalid event signing input.');
  }
  const keyBytes = new Uint8Array(parseEventSecret(secret));
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
  } finally {
    keyBytes.fill(0);
  }
  const signed = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${webhookId}.${timestamp}.${body}`),
  );
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return `v1,${encoded}`;
}

/**
 * Compare all UTF-16 code units without returning early on mismatches. Work depends
 * on the public input lengths, not the matching prefix. JavaScript runtimes cannot
 * promise native timing guarantees; do not normalize either challenge beforehand.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = index < a.length ? a.charCodeAt(index) : 0;
    const right = index < b.length ? b.charCodeAt(index) : 0;
    difference |= left ^ right;
  }
  return difference === 0;
}

export type CallbackValidationReason =
  | 'invalid_callback_url'
  | 'invalid_callback_origin'
  | 'callback_origin_not_configured'
  | 'callback_origin_mismatch';

const CALLBACK_MESSAGES: Record<CallbackValidationReason, string> = {
  invalid_callback_url: 'Callback URL is invalid or not permitted.',
  invalid_callback_origin: 'Configured callback origin is invalid or not permitted.',
  callback_origin_not_configured: 'An approved callback origin must be configured before subscribing.',
  callback_origin_mismatch: 'Callback origin does not match the configured origin.',
};

/** Errors are safe to report: neither their message nor properties contain a callback path or secret. */
export class CallbackValidationError extends Error {
  readonly reason: CallbackValidationReason;
  readonly candidateOrigin?: string;

  constructor(reason: CallbackValidationReason, candidateOrigin?: string) {
    // Defend against untyped callers supplying arbitrary diagnostic text.
    const safeReason = Object.prototype.hasOwnProperty.call(CALLBACK_MESSAGES, reason)
      ? reason : 'invalid_callback_url';
    super(CALLBACK_MESSAGES[safeReason]);
    this.name = 'CallbackValidationError';
    this.reason = safeReason;
    const candidate = parseSafeCallbackUrl(candidateOrigin);
    if (candidate && candidate.origin === candidateOrigin) this.candidateOrigin = candidate.origin;
  }
}

function parseSafeCallbackUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192
    || UNSAFE_URL_TEXT.test(value) || ENCODED_UNSAFE_TEXT.test(value)) return null;

  // Require an explicit authority, not a relative/protocol-relative URI or a URL
  // that WHATWG parsing would repair. Forbid even empty userinfo and encoded hosts.
  const authority = /^https:\/\/([^/?#]+)(?:[/?]|$)/i.exec(value)?.[1];
  if (!authority || !/^[a-z0-9.-]+(?::443)?$/i.test(authority)) return null;

  try {
    // Check before WHATWG dot-segment normalization can discard unsafe segments.
    if (UNSAFE_DECODED_TEXT.test(decodeURIComponent(value))) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return null;
    const hostname = url.hostname;
    if (hostname.length > 253 || !hostname.split('.').every(label =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    // A suffix boundary is essential: evilchatgpt.com and chatgpt.com.evil.test
    // are not approved. This also rejects IP literals and localhost forms.
    if (!OPENAI_ROOTS.some(root => hostname === root || hostname.endsWith(`.${root}`))) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Fail closed until an independently approved, exact HTTPS origin is configured.
 * No real callback is guessed here. Root-domain membership alone is insufficient.
 * Callers must also prevent redirects and apply their runtime's connection-time
 * destination protections; this pure parser does not resolve or pin DNS addresses.
 */
export function validateCallbackUrl(value: unknown, configuredOrigin?: string): URL {
  const callback = parseSafeCallbackUrl(value);
  if (!callback) throw new CallbackValidationError('invalid_callback_url');
  if (configuredOrigin === undefined || configuredOrigin === '') {
    throw new CallbackValidationError('callback_origin_not_configured', callback.origin);
  }
  const configured = parseSafeCallbackUrl(configuredOrigin);
  if (typeof configuredOrigin !== 'string' || !ORIGIN_ONLY.test(configuredOrigin) || !configured) {
    throw new CallbackValidationError('invalid_callback_origin', callback.origin);
  }
  if (callback.origin !== configured.origin) {
    throw new CallbackValidationError('callback_origin_mismatch', callback.origin);
  }
  return callback;
}
