import {
  DEMO_PROJECT_ID,
  DEMO_PROJECT_TITLE,
  DEMO_USER_ID,
  getMissingModelConfig,
  normalizeModelId,
  resolveDemoMode
} from "@/shared/config";
import { getDemoBootstrap } from "@/apps/tunee/lib/bootstrap";
import {
  inferPreferenceSignals,
  TasteMemoryStore
} from "@/apps/tunee/lib/memory/taste-memory";
import { runLiveTurn } from "@/apps/tunee/lib/mastra/live-engine";
import { runMockTurn } from "@/apps/tunee/lib/mastra/mock-engine";
import { refreshQueuedGenerations } from "@/apps/tunee/lib/providers/music-provider";
import { ProjectStore } from "@/apps/tunee/lib/projects/project-store";
import type { ChatResponse, ChatStreamEvent } from "@/apps/tunee/lib/types/tunee";

interface ProcessChatTurnInput {
  userId?: string;
  projectId?: string;
  modelId?: string;
  message: string;
  onEvent?: (event: ChatStreamEvent) => Promise<void> | void;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "服务器发生了未知错误。";
}

async function emitEvent(
  handler: ProcessChatTurnInput["onEvent"],
  event: ChatStreamEvent
): Promise<void> {
  if (!handler) {
    return;
  }

  await handler(event);
}

async function emitTrace(
  handler: ProcessChatTurnInput["onEvent"],
  key: string,
  label: string,
  status: "running" | "completed",
  detail?: string
): Promise<void> {
  await emitEvent(handler, {
    type: "trace",
    key,
    label,
    status,
    detail
  });
}

function getConversationSeedTitle(projectId: string): string {
  return projectId === DEMO_PROJECT_ID ? DEMO_PROJECT_TITLE : "新对话";
}

export async function processChatTurn(
  input: ProcessChatTurnInput
): Promise<ChatResponse> {
  const userId = input.userId?.trim() || DEMO_USER_ID;
  const projectId = input.projectId?.trim() || DEMO_PROJECT_ID;
  const modelId = normalizeModelId(input.modelId);
  const message = input.message.trim();
  const projectStore = new ProjectStore();
  const memoryStore = new TasteMemoryStore();
  const warnings: string[] = [];

  await emitTrace(input.onEvent, "conversation", "读取当前会话", "running");
  await projectStore.ensureProject({
    userId,
    projectId,
    title: getConversationSeedTitle(projectId)
  });
  await emitTrace(input.onEvent, "conversation", "读取当前会话", "completed");

  const signals = inferPreferenceSignals(message);
  if (signals.length > 0) {
    await emitTrace(input.onEvent, "memory", "更新 Taste Memory", "running");
    for (const signal of signals) {
      await memoryStore.remember({
        userId,
        category: signal.category,
        summary: signal.summary,
        evidence: signal.evidence
      });
    }
    await emitTrace(
      input.onEvent,
      "memory",
      "更新 Taste Memory",
      "completed",
      `已记录 ${signals.length} 条偏好`
    );
  }

  await projectStore.appendMessage({
    projectId,
    role: "user",
    content: message,
    modelId
  });

  let mode = resolveDemoMode(modelId);
  let turn;

  if (mode === "live") {
    try {
      turn = await runLiveTurn({
        userId,
        projectId,
        modelId,
        message,
        onTrace: async (trace) => {
          await emitEvent(input.onEvent, {
            type: "trace",
            key: trace.key,
            label: trace.label,
            status: trace.status,
            detail: trace.detail
          });
        },
        onUsage: async (usage) => {
          await emitEvent(input.onEvent, {
            type: "usage",
            key: usage.key,
            label: usage.label,
            usage: usage.usage,
            cumulative: usage.cumulative
          });
        },
        onReplyDelta: async (delta) => {
          await emitEvent(input.onEvent, {
            type: "reply_delta",
            delta
          });
        }
      });
    } catch (error) {
      mode = "mock";
      warnings.push(
        `Live OpenAI-compatible call failed and the demo fell back to mock mode: ${getErrorMessage(
          error
        )}`
      );
      turn = await runMockTurn({
        userId,
        projectId,
        modelId,
        message,
        onTrace: async (trace) => {
          await emitEvent(input.onEvent, {
            type: "trace",
            key: trace.key,
            label: trace.label,
            status: trace.status,
            detail: trace.detail
          });
        },
        onReplyDelta: async (delta) => {
          await emitEvent(input.onEvent, {
            type: "reply_delta",
            delta
          });
        }
      });
    }
  } else {
    const missingConfig = getMissingModelConfig(modelId);
    if (modelId !== "demo/mock" && missingConfig) {
      warnings.push(
        `Live mode is not configured yet. Add ${missingConfig} to switch this conversation from mock mode to the real OpenAI-compatible model.`
      );
    }

    turn = await runMockTurn({
      userId,
      projectId,
      modelId,
      message,
      onTrace: async (trace) => {
        await emitEvent(input.onEvent, {
          type: "trace",
          key: trace.key,
          label: trace.label,
          status: trace.status,
          detail: trace.detail
        });
      },
      onReplyDelta: async (delta) => {
        await emitEvent(input.onEvent, {
          type: "reply_delta",
          delta
        });
      }
    });
  }

  await projectStore.appendMessage({
    projectId,
    role: "assistant",
    parts: turn.parts,
    modelId
  });

  await refreshQueuedGenerations(projectId);
  const bootstrap = await getDemoBootstrap(modelId, projectId);

  return {
    ...bootstrap,
    reply: turn.reply,
    warnings,
    mode
  };
}
