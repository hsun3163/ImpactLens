import type { Metadata } from 'next';
import CourseMaintenance from '@/components/CourseMaintenance';
import '../../courses/courses.css';
export const metadata: Metadata = { title: 'Course maintenance demo · ImpactLens', description: 'Try course maintenance with fictional browser-local data. No sign-in or SMS setup required.' };
export default function CourseMaintenanceDemoPage() { return <CourseMaintenance demo/>; }
