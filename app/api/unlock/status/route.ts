import { NextResponse } from 'next/server';
import { isPinConfigured } from '@/lib/pin-auth';

export async function GET() {
  return NextResponse.json({ configured: isPinConfigured() });
}
