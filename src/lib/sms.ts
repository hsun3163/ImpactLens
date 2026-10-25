/** Deterministic SMS contract. No model, inference, or participant-level data. */
export const SMS_EXAMPLE = '20 2';
export const SMS_FORMAT = 'attendees hours, for example 20 2 (20 attendee visits, 2 session hours)';
export type SmsMetrics = { attendees: number; sessionMinutes: number };
export type SmsParseResult = { ok: true; metrics: SmsMetrics } | { ok: false; reason: string };
export type SmsCommand = { ok: true; kind: 'repeat' } | { ok: true; kind: 'numeric'; metrics: SmsMetrics } | { ok: false; reason: string };
/** A repeat is a command, not invented metrics. Resolve its baseline atomically. */
export function parseSmsCommand(body: string): SmsCommand {
  if (body.length <= 1600 && body.trim() === '1') return { ok: true, kind: 'repeat' };
  const parsed = parseSms(body);
  return parsed.ok ? { ...parsed, kind: 'numeric' } : parsed;
}
export function parseSms(body: string): SmsParseResult {
  if (body.length > 1600) return { ok: false, reason: 'Message is longer than 1,600 characters.' };
  const match = /^(0|[1-9]\d{0,4}) +((?:0|[1-9]\d?)(?:\.(?:25|5|50|75))?)$/.exec(body.trim());
  if (!match) return { ok: false, reason: `Use exactly ${SMS_FORMAT}. Hours may use .25, .5, or .75.` };
  const attendees = Number(match[1]); const sessionMinutes = Number(match[2]) * 60;
  if (attendees > 10000 || sessionMinutes < 15 || sessionMinutes > 1440) return { ok: false, reason: 'Attendees must be 0–10,000; hours must be 0.25–24 in quarter-hour increments.' };
  return { ok: true, metrics: { attendees, sessionMinutes } };
}
export function isE164(value: string): boolean { return /^\+[1-9]\d{7,14}$/.test(value); }

/** Twilio signs the configured external URL plus sorted form keys and values. */
export async function verifyTwilioSignature(url: string, params: URLSearchParams, signature: string, authToken: string): Promise<boolean> {
  if (!/^[A-Za-z0-9+/]{27}=$/.test(signature) || !authToken) return false;
  // Twilio's SMS webhook uses single-valued parameters. Ambiguous duplicates fail closed.
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return false;
  const payload = url + keys.sort().map(key => key + params.get(key)!).join('');
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['verify']);
    const bytes = Uint8Array.from(atob(signature), char => char.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(payload));
  } catch { return false; }
}

/** A leading minus retracts one exact attendance event; it never adds negative counts. */
export function parseSmsReversal(body: string): SmsParseResult {
  if (body.length > 1600 || !/^-[0-9]/.test(body.trim())) return { ok: false, reason: 'Use -attendees hours to reverse one matching session.' };
  return parseSms(body.trim().slice(1));
}
