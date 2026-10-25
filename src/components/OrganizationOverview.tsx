'use client';

import { CourseAttendanceChart } from './CourseAttendance';
import type { CourseAttendanceData } from '@/lib/course-attendance';
import { groupDashboardCourses } from '@/lib/organization-dashboard';

export default function OrganizationOverview({ organizationId, attendance, synthetic = false, truncated = false }: {
  organizationId: string; attendance: CourseAttendanceData[]; synthetic?: boolean; truncated?: boolean;
}) {
  const groups = groupDashboardCourses(attendance, organizationId);
  return <div className="org-programs">{groups.length ? groups.map(program => <section className="org-program" key={program.id} aria-labelledby={`program-${program.id}`}><div className="org-program-heading"><h2 id={`program-${program.id}`}>{program.name}</h2><span>{program.courses.length} {program.courses.length === 1 ? 'program' : 'programs'}</span></div><div className="org-course-grid">{program.courses.map(data => <article className="org-course" key={data.course.id}><CourseAttendanceChart data={data} synthetic={synthetic} compact/></article>)}</div></section>) : <div className="org-empty"><h2>Add your first program.</h2></div>}{truncated && <p className="org-scope-note">Showing {attendance.length} programs. Center totals include all programs.</p>}</div>;
}
