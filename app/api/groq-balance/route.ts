import { NextResponse } from 'next/server';

type CreditsResponse = {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
  total_credits?: number;
  total_usage?: number;
  credits?: number;
  usage?: number;
};

function pickNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function GET() {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
    }

    const response = await fetch('https://api.groq.com/openai/v1/credits', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Groq credits API error:', errorText);
      return NextResponse.json({ error: 'Failed to fetch Groq balance' }, { status: response.status });
    }

    const data = (await response.json().catch(() => ({}))) as CreditsResponse;

    const totalCredits =
      pickNumber(data.data?.total_credits) ??
      pickNumber(data.total_credits) ??
      pickNumber(data.credits) ??
      0;

    const totalUsage =
      pickNumber(data.data?.total_usage) ??
      pickNumber(data.total_usage) ??
      pickNumber(data.usage) ??
      0;

    const balance = totalCredits - totalUsage;

    return NextResponse.json({
      balance,
      totalCredits,
      totalUsage,
    });
  } catch (error) {
    console.error('Groq balance fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch Groq balance' }, { status: 500 });
  }
}
