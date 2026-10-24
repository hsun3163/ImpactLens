import { env } from 'cloudflare:workers';
import { handleApi } from '@/server/api';
import { handleSmsApi } from '@/server/sms-api';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return new URL(request.url).pathname.startsWith('/api/sms/') ? handleSmsApi(request, env) : handleApi(request, env); }
export async function POST(request: Request) { return new URL(request.url).pathname.startsWith('/api/sms/') ? handleSmsApi(request, env) : handleApi(request, env); }
