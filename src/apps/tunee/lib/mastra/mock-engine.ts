import { runTurn, type TurnResult } from "@/apps/tunee/lib/mastra/shared-turn";

export async function runMockTurn(input: {
  userId: string;
  projectId: string;
  modelId: string;
  message: string;
  onTrace?: (trace: import("@/apps/tunee/lib/mastra/shared-turn").TurnTrace) => Promise<void> | void;
  onUsage?: (usage: import("@/apps/tunee/lib/mastra/shared-turn").TurnUsage) => Promise<void> | void;
  onReplyDelta?: (delta: string) => Promise<void> | void;
}): Promise<TurnResult> {
  return runTurn({
    ...input,
    source: "mock"
  });
}
