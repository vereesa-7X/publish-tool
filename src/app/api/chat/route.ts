import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processChatTurn, getErrorMessage } from "@/apps/tunee/lib/chat/process-chat-turn";

const bodySchema = z.object({
  userId: z.string().optional(),
  conversationId: z.string().optional(),
  modelId: z.string().optional(),
  message: z.string().min(1)
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const parsed = bodySchema.parse(await request.json());
    const result = await processChatTurn({
      userId: parsed.userId,
      projectId: parsed.conversationId,
      modelId: parsed.modelId,
      message: parsed.message
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error)
      },
      {
        status: 500
      }
    );
  }
}
