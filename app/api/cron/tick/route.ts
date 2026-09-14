import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/services/tick";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) return new NextResponse(null, { status: 401 });
  const result = await runTick(new Date());
  return NextResponse.json(result);
}
