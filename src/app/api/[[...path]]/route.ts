import { env, waitUntil } from 'cloudflare:workers';
import { handleApi } from '@/server/api';
import { handleSmsApi } from '@/server/sms-api';
import { handleBusinessAgentHttp } from '@/server/business-agent-http';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return new URL(request.url).pathname.startsWith('/api/business-agent/') ? handleBusinessAgentHttp(request) : new URL(request.url).pathname.startsWith('/api/sms/') ? handleSmsApi(request, env, waitUntil) : handleApi(request, env); }
export async function POST(request: Request) { return new URL(request.url).pathname.startsWith('/api/business-agent/') ? handleBusinessAgentHttp(request) : new URL(request.url).pathname.startsWith('/api/sms/') ? handleSmsApi(request, env, waitUntil) : handleApi(request, env); }
