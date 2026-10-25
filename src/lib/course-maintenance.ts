import {
  COURSE_SUMMARY_SOURCE, CourseSummaryError, courseSummaryDraftToWrite, courseSummaryToDraft,
  validateCourseSummary, type CourseSummary, type CourseSummaryDraft, type CourseSummaryWrite,
} from './course-summary';

/** Constants!A2:A32 in the existing TPW workbook. This is its vocabulary, not a current statewide inventory. */
export const CDCR_FACILITIES = [
  'Avenal State Prison (ASP)',
  'California Correctional Institution (CCI)',
  'California Health Care Facility (CHCF), Stockton',
  'California Institution for Men (CIM)',
  'California Institution for Women (CIW)',
  'California Men’s Colony (CMC)',
  'California Medical Facility (CMF)',
  'California Rehabilitation Center (CRC)',
  'California State Prison, Corcoran (COR)',
  'California State Prison, Los Angeles County (LAC)',
  'California State Prison, Sacramento (SAC)',
  'California State Prison, Solano (SOL)',
  'Calipatria State Prison (CAL)',
  'California State Prison, Centinela (CEN)',
  'Central California Women’s Facility (CCWF)',
  'Correctional Training Facility (CTF)',
  'Folsom State Prison (FSP)',
  'High Desert State Prison (HDSP)',
  'Ironwood State Prison (ISP)',
  'Kern Valley State Prison (KVSP)',
  'Mule Creek State Prison (MCSP)',
  'North Kern State Prison (NKSP)',
  'Pelican Bay State Prison (PBSP)',
  'Pleasant Valley State Prison (PVSP)',
  'Richard J. Donovan Correctional Facility (RJD)',
  'Salinas Valley State Prison (SVSP)',
  'San Quentin Rehabilitation Center (SQ)',
  'Sierra Conservation Center (SCC)',
  'Substance Abuse Treatment Facility and State Prison, Corcoran (SATF-CSP, Corcoran)',
  'Valley State Prison (VSP)',
  'Wasco State Prison (WSP)',
] as const;
export type CourseOrganization = { id: string; name: string; active: boolean };
export type CourseProgram = CourseOrganization & { organizationId: string };
export type CourseWorkspace = { organizations: CourseOrganization[]; programs: CourseProgram[]; summaries: CourseSummary[] };
export type CourseMetadataWrite = { action: 'organization' | 'program'; id?: string; createId?: string; organizationId?: string; name: string };
export const COURSE_DEMO_STORAGE_KEY = 'impactlens.course-maintenance.demo.v1';

export function newCourseDraft(organizationId: string, programId: string, context?: Pick<CourseSummary, 'facility' | 'yard'>): CourseSummaryDraft {
  return { id: '', revision: 0, organizationId, programId, facility: context?.facility ?? '', yard: context?.yard ?? '',
    status: 'planned', startDate: '', endDate: '', courseHoursPerParticipant: '', participants: '', completers: '', notes: '' };
}
/** Reuse context, never the previous run's dates, result counts, hours or notes. */
export function anotherCourseDraft(summary: CourseSummary): CourseSummaryDraft {
  return newCourseDraft(summary.organizationId, summary.programId, summary);
}
export function maintenanceDraftToWrite(draft: CourseSummaryDraft, id: string, original?: CourseSummary): CourseSummaryWrite {
  const facility = draft.facility.trim();
  // Existing legacy labels remain editable without an implicit migration. New selections use the source vocabulary.
  if (facility && !CDCR_FACILITIES.some(value => value === facility) && facility !== original?.facility) {
    throw new CourseSummaryError(400, 'INVALID_FACILITY', 'Choose a CDCR facility from the existing list, or leave it blank.');
  }
  return courseSummaryDraftToWrite(draft, id);
}
export function courseDerivedValues(summary: Pick<CourseSummaryWrite, 'startDate' | 'courseHoursPerParticipant' | 'completers'>) {
  return { programYear: summary.startDate ? summary.startDate.slice(0, 4) : null,
    completedParticipantHours: summary.courseHoursPerParticipant === null || summary.completers === null ? null : summary.courseHoursPerParticipant * summary.completers };
}
export function applyDemoCourseSave(workspace: CourseWorkspace, write: CourseSummaryWrite, now = new Date().toISOString()): CourseWorkspace {
  const input = validateCourseSummary(write);
  const organization = workspace.organizations.find(item => item.id === input.organizationId);
  const program = workspace.programs.find(item => item.id === input.programId && item.organizationId === input.organizationId);
  if (!organization || !program) throw new Error('Choose a saved organization and program.');
  const current = workspace.summaries.find(item => item.id === input.id);
  if ((current?.revision ?? 0) !== input.revision) throw new Error('This course changed. Reopen its saved version before editing.');
  const saved: CourseSummary = { ...input, revision: input.revision + 1, organizationName: organization.name, programName: program.name,
    source: COURSE_SUMMARY_SOURCE, createdAt: current?.createdAt ?? now, updatedAt: now };
  return { ...workspace, summaries: [saved, ...workspace.summaries.filter(item => item.id !== saved.id)] };
}
export function applyDemoMetadata(workspace: CourseWorkspace, input: CourseMetadataWrite, newId: string): CourseWorkspace {
  const name = input.name.trim();
  if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Use a name of 1–100 characters without control characters.');
  const id = input.id ?? input.createId ?? newId;
  if (input.action === 'organization') {
    const existing = workspace.organizations.find(item => item.id === id);
    if (input.createId && existing) { if (existing.name !== name) throw new Error('This create request was already used for another organization name.'); return workspace; }
    if (input.id && !existing) throw new Error('Organization not found.');
    return { ...workspace, organizations: existing ? workspace.organizations.map(item => item.id === id ? { ...item, name } : item) : [...workspace.organizations, { id, name, active: true }],
      summaries: workspace.summaries.map(item => item.organizationId === id ? { ...item, organizationName: name } : item) };
  }
  if (!workspace.organizations.some(item => item.id === input.organizationId)) throw new Error('Choose a saved organization.');
  const existing = workspace.programs.find(item => item.id === id);
  if (input.createId && existing) { if (existing.name !== name || existing.organizationId !== input.organizationId) throw new Error('This create request was already used for another program.'); return workspace; }
  if (input.id && !existing) throw new Error('Program not found.');
  if (existing && existing.organizationId !== input.organizationId) throw new Error('A program stays with its organization.');
  return { ...workspace, programs: existing ? workspace.programs.map(item => item.id === id ? { ...item, name } : item) : [...workspace.programs, { id, name, organizationId: input.organizationId!, active: true }],
    summaries: workspace.summaries.map(item => item.programId === id ? { ...item, programName: name } : item) };
}
export function createCourseDemo(): CourseWorkspace {
  const organizationId = '71000000-0000-4000-8000-000000000001';
  const otherOrganizationId = '71000000-0000-4000-8000-000000000002';
  const programId = '72000000-0000-4000-8000-000000000001';
  const secondProgramId = '72000000-0000-4000-8000-000000000002';
  const otherProgramId = '72000000-0000-4000-8000-000000000003';
  let workspace: CourseWorkspace = {
    organizations: [{ id: organizationId, name: 'Demo Learning Collective', active: true }, { id: otherOrganizationId, name: 'Demo Community Arts', active: true }],
    programs: [{ id: programId, organizationId, name: 'Resilience Workshop', active: true }, { id: secondProgramId, organizationId, name: 'Peer Learning', active: true }, { id: otherProgramId, organizationId: otherOrganizationId, name: 'Creative Practice', active: true }], summaries: [],
  };
  const seed: CourseSummaryWrite[] = [
    { id: '73000000-0000-4000-8000-000000000001', revision: 0, organizationId, programId, facility: CDCR_FACILITIES[26], yard: 'North', status: 'completed', startDate: '2026-01-12', endDate: '2026-04-06', courseHoursPerParticipant: 30, participants: 24, completers: 20, notes: null },
    { id: '73000000-0000-4000-8000-000000000002', revision: 0, organizationId, programId, facility: CDCR_FACILITIES[19], yard: 'A Yard', status: 'in-progress', startDate: '2026-09-07', endDate: null, courseHoursPerParticipant: null, participants: 18, completers: null, notes: null },
    { id: '73000000-0000-4000-8000-000000000003', revision: 0, organizationId, programId: secondProgramId, facility: CDCR_FACILITIES[6], yard: '', status: 'planned', startDate: null, endDate: null, courseHoursPerParticipant: null, participants: null, completers: null, notes: null },
    { id: '73000000-0000-4000-8000-000000000004', revision: 0, organizationId: otherOrganizationId, programId: otherProgramId, facility: CDCR_FACILITIES[0], yard: 'B', status: 'completed', startDate: '2026-02-03', endDate: '2026-05-05', courseHoursPerParticipant: 26, participants: 16, completers: 13, notes: null },
  ];
  for (const item of seed) workspace = applyDemoCourseSave(workspace, item, '2026-10-24T12:00:00.000Z');
  return workspace;
}
export function serializeCourseDemo(workspace: CourseWorkspace): string { return JSON.stringify({ version: 1, workspace }); }
export function parseCourseDemo(serialized: string): CourseWorkspace {
  const value = JSON.parse(serialized);
  if (value?.version !== 1 || !value.workspace || !Array.isArray(value.workspace.organizations) || !Array.isArray(value.workspace.programs) || !Array.isArray(value.workspace.summaries)) throw new Error('Saved demo data could not be read.');
  const workspace = value.workspace as CourseWorkspace;
  for (const item of [...workspace.organizations, ...workspace.programs]) {
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || typeof item.active !== 'boolean') throw new Error('Saved demo data could not be read.');
  }
  for (const program of workspace.programs) if (!workspace.organizations.some(item => item.id === program.organizationId)) throw new Error('Saved demo data could not be read.');
  for (const summary of workspace.summaries) {
    courseSummaryDraftToWrite(courseSummaryToDraft(summary));
    if (!workspace.programs.some(program => program.id === summary.programId && program.organizationId === summary.organizationId) || summary.revision < 1) throw new Error('Saved demo data could not be read.');
  }
  return workspace;
}
