import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDemoBootstrap } from "@/apps/tunee/lib/bootstrap";
import { DEMO_USER_ID, normalizeModelId } from "@/shared/config";
import { ProjectStore } from "@/apps/tunee/lib/projects/project-store";

const bodySchema = z.object({
  title: z.string().optional(),
  modelId: z.string().optional()
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "服务器发生了未知错误。";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const parsed = bodySchema.parse(await request.json().catch(() => ({})));
    const projectStore = new ProjectStore();
    const conversation = await projectStore.createConversation({
      userId: DEMO_USER_ID,
      title: parsed.title
    });
    const bootstrap = await getDemoBootstrap(
      normalizeModelId(parsed.modelId),
      conversation.id
    );

    return NextResponse.json(bootstrap);
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
