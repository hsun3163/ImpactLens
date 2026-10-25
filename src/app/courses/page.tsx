import type { Metadata } from 'next';
import CourseMaintenance from '@/components/CourseMaintenance';
import './courses.css';
export const metadata: Metadata = { title: 'Course maintenance · ImpactLens', description: 'Maintain existing organization, program and course information independently from SMS check-ins.' };
export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ organizationId?: string | string[] }> }) {
  const query = await searchParams;
  return <CourseMaintenance initialOrganizationId={typeof query.organizationId === 'string' ? query.organizationId : undefined}/>;
}
