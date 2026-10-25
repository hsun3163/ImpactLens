import type { Metadata } from 'next';
import CourseMaintenance from '@/components/CourseMaintenance';
import './courses.css';
export const metadata: Metadata = { title: 'Manage programs · ImpactLens', description: 'Manage program details and session reporting.' };
export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ organizationId?: string | string[] }> }) {
  const query = await searchParams;
  return <CourseMaintenance initialOrganizationId={typeof query.organizationId === 'string' ? query.organizationId : undefined}/>;
}
