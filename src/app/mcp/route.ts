import { env } from 'cloudflare:workers';
import { handleBusinessMcp } from '@/server/business-agent-mcp';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return handleBusinessMcp(request,env); }
export async function GET(request: Request) { return handleBusinessMcp(request,env); }
