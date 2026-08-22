import { NextResponse } from "next/server";

export async function GET() {
  try {
    const hasKey = !!process.env.GEMINI_API_KEY;
    return NextResponse.json({ hasKey });
  } catch {
    return NextResponse.json({ hasKey: false });
  }
}
