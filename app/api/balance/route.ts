import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY not configured' },
        { status: 500 }
      );
    }

    const response = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter credits API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to fetch balance' },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Calculate remaining balance
    const balance = (data.data?.total_credits || 0) - (data.data?.total_usage || 0);
    
    return NextResponse.json({
      balance: balance,
      totalCredits: data.data?.total_credits || 0,
      totalUsage: data.data?.total_usage || 0,
    });
  } catch (error) {
    console.error('Balance fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch balance' },
      { status: 500 }
    );
  }
}
