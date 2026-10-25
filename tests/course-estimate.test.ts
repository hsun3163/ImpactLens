import test from 'node:test';
import assert from 'node:assert/strict';
import { courseServiceEstimate, sumCourseServiceEstimates } from '../src/lib/course-estimate';
import { courseDerivedValues } from '../src/lib/course-maintenance';

test('unbound configured estimates use participants, not completers, and stay separate from completed hours', () => {
  const course={participants:20,completers:15,courseHoursPerParticipant:24.5,startDate:'2026-01-01'};
  assert.deepEqual(courseServiceEstimate(course,false),{hasPhoneBinding:false,participantHours:490});
  assert.deepEqual(courseServiceEstimate(course,true),{hasPhoneBinding:true,participantHours:null});
  assert.equal(courseDerivedValues(course).completedParticipantHours,367.5);
});
test('unbound estimate unknown inputs never become zero; explicit zero with known values remains zero', () => {
  for(const [participants,courseHoursPerParticipant] of [[null,5],[4,null],[0,null],[null,0],[null,null]] as const) assert.equal(courseServiceEstimate({participants,courseHoursPerParticipant},false).participantHours,null);
  for(const [participants,courseHoursPerParticipant] of [[0,5],[4,0],[0,0]] as const) assert.equal(courseServiceEstimate({participants,courseHoursPerParticipant},false).participantHours,0);
});
test('aggregate unbound estimates deduplicate course IDs, exclude bound courses, and report missing coverage', () => {
  const entries=[{id:'a',serviceEstimate:courseServiceEstimate({participants:10,courseHoursPerParticipant:2},false)},
    {id:'b',serviceEstimate:courseServiceEstimate({participants:0,courseHoursPerParticipant:2},false)},
    {id:'c',serviceEstimate:courseServiceEstimate({participants:10,courseHoursPerParticipant:null},false)},
    {id:'d',serviceEstimate:courseServiceEstimate({participants:999,courseHoursPerParticipant:999},true)}];
  assert.deepEqual(sumCourseServiceEstimates([...entries,entries[0]]),{participantHours:20,courseCount:3,missingValuesCount:1});
  assert.deepEqual(sumCourseServiceEstimates([]),{participantHours:0,courseCount:0,missingValuesCount:0});
});
