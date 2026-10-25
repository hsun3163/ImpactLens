/** Display alias only: persisted organization identities and provenance are unchanged. */
export function centerDisplayName(name: string): string {
  return name === 'Defy SIM' ? 'Defy' : name;
}
export function centerHref(id: string): string { return `/?organizationId=${encodeURIComponent(id)}`; }
export function dashboardLocation(search: string) {
  const params = new URLSearchParams(search);
  return { requestedId: params.get('organizationId') ?? '', overview: params.get('view') === 'tpw' };
}
