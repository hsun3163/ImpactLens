import test from 'node:test';
import assert from 'node:assert/strict';
import { participantMaximum, programParticipantEstimate, sumParticipantEstimates, participantEstimateTotalValue } from '../src/lib/participant-estimate';

test('program participants use the highest counted attendance, rather than their sum or a larger configured count', () => {
  assert.deepEqual(programParticipantEstimate({ sessions: 3, maximumAttendance: participantMaximum([16, 15, 29]) }, 45), { value: 29, source: 'sms-maximum' });
  assert.equal(participantMaximum([16, 15, 29]), 29);
});
test('counted zero takes precedence over configured participants; missing observations use configured maximum', () => {
  assert.deepEqual(programParticipantEstimate({ sessions: 1, maximumAttendance: 0 }, 45), { value: 0, source: 'sms-maximum' });
  assert.deepEqual(programParticipantEstimate({ sessions: 0, maximumAttendance: null }, participantMaximum([20, 45, null])), { value: 45, source: 'configured-maximum' });
  assert.deepEqual(programParticipantEstimate({ sessions: 0, maximumAttendance: null }, 0), { value: 0, source: 'configured-maximum' });
});
test('missing values stay unknown and malformed observation summaries never fall back to a different basis', () => {
  assert.deepEqual(programParticipantEstimate({ sessions: 0, maximumAttendance: null }, null), { value: null, source: 'unknown' });
  assert.deepEqual(programParticipantEstimate({ sessions: 2, maximumAttendance: null }, 50), { value: null, source: 'unknown' });
  assert.equal(participantMaximum([undefined, null, NaN, Infinity, -1, 1.5]), null);
  assert.equal(participantMaximum([undefined, null, 0]), 0);
});
test('network totals add each organization/program maximum once and keep missing programs explicit', () => {
  const known = { value: 29, source: 'sms-maximum' as const }; const unknown = { value: null, source: 'unknown' as const };
  const totals = sumParticipantEstimates([
    { organizationId: 'one', programId: 'a', participantEstimate: known },
    { organizationId: 'one', programId: 'a', participantEstimate: known },
    { organizationId: 'one', programId: 'b', participantEstimate: unknown },
    { organizationId: 'two', programId: 'a', participantEstimate: { value: 16, source: 'configured-maximum' } },
  ]);
  assert.deepEqual(totals, { participants: 45, programCount: 3, missingValuesCount: 1 });
  assert.equal(participantEstimateTotalValue(totals), 45);
  assert.equal(participantEstimateTotalValue({ participants: 0, programCount: 1, missingValuesCount: 1 }), null);
  assert.equal(participantEstimateTotalValue({ participants: 0, programCount: 1, missingValuesCount: 0 }), 0);
  assert.equal(participantEstimateTotalValue(sumParticipantEstimates([])), 0);
  assert.equal(participantEstimateTotalValue(undefined), null);
});
