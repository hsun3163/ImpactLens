import type { Metadata } from 'next';
import OrganizationHome from '@/components/OrganizationHome';
import './sms/sms.css';
import './organization.css';
export const metadata: Metadata = { title: 'Organization dashboard · ImpactLens', description: 'Program participants and session attendance.' };
export default function Home() { return <OrganizationHome/>; }
