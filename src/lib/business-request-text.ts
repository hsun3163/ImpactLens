import { parseSmsCommand } from './sms';
/** Maintenance requests need actual language. Malformed numeric attendance stays
 * in quarantine and must not become an automatic assistant wake. */
export function isBusinessRequestText(body: string): boolean {
  return Boolean(body.trim()) && body.length <= 1600 && !parseSmsCommand(body).ok
    && /\p{L}/u.test(body) && !/^[\d\s.,+\-eE]+$/.test(body.trim());
}
