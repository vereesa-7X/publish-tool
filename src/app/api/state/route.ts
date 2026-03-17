import { NextRequest, NextResponse } from "next/server";
import { getDemoBootstrap } from "@/apps/tunee/lib/bootstrap";
import { DEMO_USER_ID } from "@/shared/config";
import { refreshQueuedGenerationsForUser } from "@/apps/tunee/lib/providers/music-provider";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const modelId = request.nextUrl.searchParams.get("modelId") ?? undefined;
  const conversationId = request.nextUrl.searchParams.get("conversationId") ?? undefined;

  await refreshQueuedGenerationsForUser(DEMO_USER_ID);
  const bootstrap = await getDemoBootstrap(modelId, conversationId);
  return NextResponse.json(bootstrap);
}
