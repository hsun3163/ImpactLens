import SmsReports from '@/components/SmsReports';

export default async function SmsReportsPage({ searchParams }: { searchParams: Promise<{ organizationId?: string | string[] }> }) {
  const query = await searchParams;
  return <SmsReports organizationId={typeof query.organizationId === 'string' ? query.organizationId : undefined} />;
}
