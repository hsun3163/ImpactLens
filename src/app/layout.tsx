import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'ImpactLens — Evidence for second chances', description: 'An auditable rehabilitation evidence workspace. Explore official CDCR aggregate data, compare cohorts, and analyze your own data privately.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
