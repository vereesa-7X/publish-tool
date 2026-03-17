import { NextRequest } from "next/server";
import { z } from "zod";
import { processChatTurn, getErrorMessage } from "@/apps/tunee/lib/chat/process-chat-turn";
import type { ChatStreamEvent } from "@/apps/tunee/lib/types/tunee";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userId: z.string().optional(),
  conversationId: z.string().optional(),
  modelId: z.string().optional(),
  message: z.string().min(1)
});

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}
`);
}

export async function POST(request: NextRequest): Promise<Response> {
  const readable = new ReadableStream({
    async start(controller) {
      const send = async (event: ChatStreamEvent) => {
        controller.enqueue(encodeEvent(event));
      };

      try {
        const parsed = bodySchema.parse(await request.json());
        const result = await processChatTurn({
          userId: parsed.userId,
          projectId: parsed.conversationId,
          modelId: parsed.modelId,
          message: parsed.message,
          onEvent: send
        });

        await send({
          type: "final",
          data: result
        });
      } catch (error) {
        await send({
          type: "error",
          error: getErrorMessage(error)
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
