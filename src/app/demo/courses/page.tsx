import type { Metadata } from 'next';
import CourseMaintenance from '@/components/CourseMaintenance';
import '../../courses/courses.css';
export const metadata: Metadata = { title: 'Manage programs · Synthetic demo · ImpactLens', description: 'Manage fictional programs saved in this browser.' };
export default async function CourseMaintenanceDemoPage({ searchParams }: { searchParams: Promise<{ organizationId?: string | string[] }> }) { const query = await searchParams; return <CourseMaintenance demo initialOrganizationId={typeof query.organizationId === 'string' ? query.organizationId : undefined}/>; }
