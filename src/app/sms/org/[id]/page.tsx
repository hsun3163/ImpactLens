import SmsDashboard from '@/components/SmsDashboard';
export default async function SmsOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SmsDashboard organizationId={id} />;
}
