import {
  DEMO_MODEL_ID,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_TITLE,
  DEMO_USER_ID,
  MODEL_SUGGESTIONS,
  normalizeModelId,
  resolveDemoMode,
  resolveMusicProviderMode
} from "@/shared/config";
import { TasteMemoryStore } from "@/apps/tunee/lib/memory/taste-memory";
import { ProjectStore } from "@/apps/tunee/lib/projects/project-store";
import type { DemoBootstrap } from "@/apps/tunee/lib/types/tunee";

export async function getDemoBootstrap(
  selectedModelId?: string,
  requestedConversationId?: string
): Promise<DemoBootstrap> {
  const projectStore = new ProjectStore();
  const memoryStore = new TasteMemoryStore();
  const modelId = normalizeModelId(selectedModelId) || DEMO_MODEL_ID;

  await projectStore.ensureProject({
    userId: DEMO_USER_ID,
    projectId: DEMO_PROJECT_ID,
    title: DEMO_PROJECT_TITLE
  });

  const conversations = await projectStore.listConversations(DEMO_USER_ID);
  const activeConversationId = conversations.some(
    (conversation) => conversation.id === requestedConversationId
  )
    ? requestedConversationId || DEMO_PROJECT_ID
    : conversations[0]?.id || DEMO_PROJECT_ID;
  const conversation = await projectStore.get(activeConversationId);
  const tasteProfile = await memoryStore.get(DEMO_USER_ID);

  return {
    userId: DEMO_USER_ID,
    conversations,
    activeConversationId,
    conversation,
    tasteProfile,
    suggestedModels: MODEL_SUGGESTIONS,
    selectedModelId: modelId,
    mode: resolveDemoMode(modelId),
    musicProviderMode: resolveMusicProviderMode()
  };
}
