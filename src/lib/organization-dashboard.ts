import type { CourseAttendanceData } from './course-attendance';
export type DashboardOrganization = { id: string; name: string; active: boolean };
/** Choose only from the authorized directory. URLs never manufacture a readable scope. */
export function selectDashboardOrganization(organizations: readonly DashboardOrganization[], requestedId = '') {
  const requested = organizations.find(item => item.id === requestedId);
  if (requested) return requested;
  const active = organizations.filter(item => item.active);
  const candidates = active.length ? active : organizations;
  return candidates.find(item => item.name.toLowerCase().replace(/[^a-z0-9]/g, '') === 'defysim')
    ?? candidates.find(item => !/\btest\b/i.test(item.name)) ?? candidates[0] ?? null;
}
export function groupDashboardCourses(courses: readonly CourseAttendanceData[], organizationId: string) {
  const groups = new Map<string, { id: string; name: string; courses: CourseAttendanceData[] }>();
  for (const data of courses) {
    if (data.course.organizationId !== organizationId) continue;
    const group = groups.get(data.course.programId) ?? { id: data.course.programId, name: data.course.programName, courses: [] };
    if (!group.courses.some(item => item.course.id === data.course.id)) group.courses.push(data);
    groups.set(group.id, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
