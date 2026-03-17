"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from "react";
import type {
  ChatMessage,
  ChatResponse,
  ChatStreamEvent,
  ChatTraceEvent,
  ChatUsageEvent,
  DemoBootstrap,
  MessagePart,
  TokenUsageStats
} from "@/apps/tunee/lib/types/tunee";

const DRAFT_STORAGE_KEY = "tunee-demo-drafts";
const MIN_COMPOSER_HEIGHT = 118;
const MAX_COMPOSER_HEIGHT = 260;

const quickPrompts = [
  "帮我做一首轻盈一点的中文女声歌，先写歌词和 music prompt。",
  "把上一版副歌改得更克制一点，保留霓虹和夜风的意象。",
  "记住我更喜欢中文、女声、city pop，不要太吵。",
  "基于最新歌词和 prompt 直接生成一版。"
];

function getSkillLabel(skill: string): string {
  const labels: Record<string, string> = {
    "Taste Memory": "偏好记忆",
    "Lyrics Skill": "写歌词",
    "Music Prompt Skill": "写音乐 Prompt",
    "Generate Music Skill": "生成音乐",
    "Assistant Reply": "回复整理"
  };

  return labels[skill] || skill;
}

function formatConversationTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? {
        hour: "2-digit",
        minute: "2-digit"
      }
    : {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      };

  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

function compactInlineText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function getPlainTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function getStatusLabel(status: Extract<MessagePart, { type: "audio" }>['status']): string {
  if (status === "queued") {
    return "生成中";
  }

  if (status === "completed") {
    return "已完成";
  }

  return "失败";
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function getActiveTrace(traces: ChatTraceEvent[]): ChatTraceEvent | null {
  return (
    [...traces].reverse().find((trace) => trace.status === "running") ||
    traces.at(-1) ||
    null
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "textarea" ||
    tagName === "input" ||
    tagName === "select"
  );
}

async function parseStreamError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

interface TuneeDemoAppProps {
  initialData: DemoBootstrap;
}

export function TuneeDemoApp({
  initialData
}: TuneeDemoAppProps): React.JSX.Element {
  const [conversations, setConversations] = useState(initialData.conversations);
  const [conversation, setConversation] = useState(initialData.conversation);
  const [activeConversationId, setActiveConversationId] = useState(
    initialData.activeConversationId
  );
  const [tasteProfile, setTasteProfile] = useState(initialData.tasteProfile);
  const [modelId, setModelId] = useState(initialData.selectedModelId);
  const [mode, setMode] = useState(initialData.mode);
  const [musicProviderMode, setMusicProviderMode] = useState(
    initialData.musicProviderMode
  );
  const [composer, setComposer] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [conversationQuery, setConversationQuery] = useState("");
  const deferredConversationQuery = useDeferredValue(conversationQuery);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showTraceDetails, setShowTraceDetails] = useState(true);
  const [streamTraces, setStreamTraces] = useState<ChatTraceEvent[]>([]);
  const [streamUsageEvents, setStreamUsageEvents] = useState<ChatUsageEvent[]>([]);
  const [lastTurnUsageEvents, setLastTurnUsageEvents] = useState<ChatUsageEvent[]>([]);
  const [streamedReply, setStreamedReply] = useState("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const isComposingRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);

  const activeTrace = getActiveTrace(streamTraces);
  const completedTraceCount = streamTraces.filter(
    (trace) => trace.status === "completed"
  ).length;
  const activeUsageEvents = isSending ? streamUsageEvents : lastTurnUsageEvents;
  const cumulativeUsage = activeUsageEvents.at(-1)?.cumulative ?? null;
  const estimatedReplyTokens = streamedReply.trim()
    ? Math.max(1, Math.round(streamedReply.trim().length / 1.6))
    : 0;
  const streamUsageByKey = new Map(streamUsageEvents.map((usage) => [usage.key, usage]));
  const filteredConversations = conversations.filter((item) => {
    const query = deferredConversationQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const draftText = drafts[item.id] || "";
    return [item.title, item.summary, item.preview, draftText]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  function focusComposer(): void {
    const element = composerRef.current;
    if (!element) {
      return;
    }

    element.focus();
    const length = element.value.length;
    element.setSelectionRange(length, length);
  }

  function focusConversationSearch(): void {
    const element = searchInputRef.current;
    if (!element) {
      return;
    }

    setIsSidebarOpen(true);
    element.focus();
    element.select();
  }

  function resizeComposer(): void {
    const element = composerRef.current;
    if (!element) {
      return;
    }

    element.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(element.scrollHeight, MIN_COMPOSER_HEIGHT),
      MAX_COMPOSER_HEIGHT
    );
    element.style.height = `${nextHeight}px`;
    element.style.overflowY =
      element.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  }

  function scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior
    });
    setIsNearBottom(true);
  }

  function announceNotice(message: string): void {
    setCopiedNotice(message);
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }

    noticeTimerRef.current = window.setTimeout(() => {
      setCopiedNotice(null);
      noticeTimerRef.current = null;
    }, 2200);
  }

  const pollConversationState = useEffectEvent((targetConversationId: string) => {
    void fetchState(targetConversationId);
  });

  const handleGlobalShortcut = useEffectEvent((event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const hasCommand = event.metaKey || event.ctrlKey;

    if (hasCommand && key === "n") {
      event.preventDefault();
      void createConversation();
      return;
    }

    if (hasCommand && key === "k") {
      event.preventDefault();
      focusConversationSearch();
      return;
    }

    if (event.key === "Escape") {
      if (isSidebarOpen) {
        event.preventDefault();
        setIsSidebarOpen(false);
      }

      if (deferredConversationQuery.trim()) {
        setConversationQuery("");
      }

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.key === "/") {
      event.preventDefault();
      focusComposer();
    }
  });

  useEffect(() => {
    try {
      const rawDrafts = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!rawDrafts) {
        return;
      }

      const parsed = JSON.parse(rawDrafts) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return;
      }

      const nextDrafts = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      );
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
      setComposer(nextDrafts[initialData.activeConversationId] || "");
    } catch {
      // Ignore malformed local drafts and continue with a clean state.
    }
  }, [initialData.activeConversationId]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    resizeComposer();
  }, [composer]);

  useEffect(() => {
    focusComposer();
    resizeComposer();
    const container = chatScrollRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto"
      });
      setIsNearBottom(true);
    }

    if (window.matchMedia("(max-width: 1080px)").matches) {
      setIsSidebarOpen(false);
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (!(isNearBottom || isSending)) {
      return;
    }

    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: isSending ? "auto" : "smooth"
    });
    setIsNearBottom(true);
  }, [conversation.messages.length, isNearBottom, isSending, streamTraces.length, streamedReply]);

  useEffect(() => {
    if (!conversations.some((item) => item.hasQueuedGeneration)) {
      return;
    }

    const interval = window.setInterval(() => {
      pollConversationState(activeConversationId);
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeConversationId, conversations]);

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => {
      window.removeEventListener("keydown", handleGlobalShortcut);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  function persistDraft(conversationId: string, value: string): void {
    setDrafts((current) => {
      const nextDrafts = { ...current };
      if (value.trim()) {
        nextDrafts[conversationId] = value;
      } else {
        delete nextDrafts[conversationId];
      }

      draftsRef.current = nextDrafts;
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDrafts));
      } catch {
        // Ignore storage failures in demo mode.
      }

      return nextDrafts;
    });
  }

  function resetStreamState(): void {
    setStreamTraces([]);
    setStreamUsageEvents([]);
    setStreamedReply("");
    setShowTraceDetails(true);
  }

  function applyBootstrap(data: DemoBootstrap): void {
    startTransition(() => {
      setConversations(data.conversations);
      setConversation(data.conversation);
      setActiveConversationId(data.activeConversationId);
      setTasteProfile(data.tasteProfile);
      setModelId(data.selectedModelId);
      setMode(data.mode);
      setMusicProviderMode(data.musicProviderMode);
    });
    setComposer(draftsRef.current[data.activeConversationId] || "");
  }

  function upsertTrace(trace: ChatTraceEvent): void {
    setStreamTraces((current) => {
      const index = current.findIndex((entry) => entry.key === trace.key);
      if (index < 0) {
        return [...current, trace];
      }

      const next = [...current];
      next[index] = trace;
      return next;
    });
  }

  function upsertUsageEvent(event: ChatUsageEvent): void {
    setStreamUsageEvents((current) => {
      const index = current.findIndex((entry) => entry.key === event.key);
      const next = [...current];

      if (index < 0) {
        next.push(event);
      } else {
        next[index] = event;
      }

      setLastTurnUsageEvents(next);
      return next;
    });
  }

  function handleStreamEvent(event: ChatStreamEvent): ChatResponse | null {
    if (event.type === "trace") {
      upsertTrace(event);
      return null;
    }

    if (event.type === "usage") {
      upsertUsageEvent(event);
      return null;
    }

    if (event.type === "reply_delta") {
      setStreamedReply((current) => current + event.delta);
      return null;
    }

    if (event.type === "final") {
      return event.data;
    }

    throw new Error(event.error);
  }

  async function fetchState(targetConversationId: string): Promise<void> {
    try {
      const response = await fetch(
        `/api/state?conversationId=${encodeURIComponent(targetConversationId)}&modelId=${encodeURIComponent(modelId)}`
      );
      const data = (await response.json()) as DemoBootstrap & { error?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error || "加载会话失败。");
      }

      applyBootstrap(data);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "加载会话失败。"
      );
    }
  }

  async function switchConversation(targetConversationId: string): Promise<void> {
    if (
      targetConversationId === activeConversationId ||
      isSwitching ||
      isSending
    ) {
      return;
    }

    setError(null);
    setLastTurnUsageEvents([]);
    setIsSwitching(true);
    resetStreamState();

    try {
      await fetchState(targetConversationId);
    } finally {
      setIsSwitching(false);
    }
  }

  async function createConversation(): Promise<void> {
    if (isCreating || isSending) {
      return;
    }

    setError(null);
    setLastTurnUsageEvents([]);
    setIsCreating(true);
    resetStreamState();

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          modelId
        })
      });
      const data = (await response.json()) as DemoBootstrap & { error?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error || "创建会话失败。");
      }

      applyBootstrap(data);
      setWarnings([]);
      setConversationQuery("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "创建会话失败。"
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function copyText(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      announceNotice(successMessage);
    } catch {
      setError("当前环境不支持复制到剪贴板。请手动复制。");
    }
  }

  function setComposerValue(value: string): void {
    setComposer(value);
    persistDraft(activeConversationId, value);
  }

  function queueComposerPrompt(value: string): void {
    setComposerValue(value);
    window.requestAnimationFrame(() => {
      focusComposer();
      resizeComposer();
    });
  }

  async function sendMessage(rawMessage: string): Promise<void> {
    const message = rawMessage.trim();
    if (!message || isSending) {
      return;
    }

    setError(null);
    setWarnings([]);
    setLastTurnUsageEvents([]);
    resetStreamState();

    const optimisticMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      parts: [
        {
          id: `local-part-${Date.now()}`,
          type: "text",
          text: message
        }
      ],
      createdAt: new Date().toISOString(),
      modelId
    };

    setConversation((current) => ({
      ...current,
      messages: [...current.messages, optimisticMessage]
    }));
    setComposer("");
    persistDraft(activeConversationId, "");
    setIsSending(true);

    try {
      const body = JSON.stringify({
        conversationId: activeConversationId,
        userId: initialData.userId,
        modelId,
        message
      });
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body
      });

      if (!response.ok) {
        throw new Error(await parseStreamError(response));
      }

      if (!response.body) {
        throw new Error("当前浏览器会话不支持流式响应。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload: ChatResponse | null = null;

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            const event = JSON.parse(line) as ChatStreamEvent;
            const maybeFinal = handleStreamEvent(event);
            if (maybeFinal) {
              finalPayload = maybeFinal;
            }
          }

          newlineIndex = buffer.indexOf("\n");
        }

        if (done) {
          break;
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        const event = JSON.parse(trailing) as ChatStreamEvent;
        const maybeFinal = handleStreamEvent(event);
        if (maybeFinal) {
          finalPayload = maybeFinal;
        }
      }

      if (!finalPayload) {
        throw new Error("流式响应提前结束，最终结果没有返回。");
      }

      applyBootstrap(finalPayload);
      setWarnings(finalPayload.warnings || []);
    } catch (requestError) {
      setConversation((current) => ({
        ...current,
        messages: current.messages.filter((entry) => entry.id !== optimisticMessage.id)
      }));
      setComposer(message);
      persistDraft(activeConversationId, message);
      setError(requestError instanceof Error ? requestError.message : "请求失败。");
    } finally {
      resetStreamState();
      setIsSending(false);
      window.requestAnimationFrame(() => {
        focusComposer();
        resizeComposer();
      });
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendMessage(composer);
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ): void {
    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(composer);
    }
  }

  function handleChatScroll(): void {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsNearBottom(distanceFromBottom < 96);
  }

  function renderUsageMetrics(
    usage: TokenUsageStats,
    compact = false
  ): React.JSX.Element {
    return (
      <div className={`usage-metrics ${compact ? "compact" : ""}`.trim()}>
        <span>输入 {formatTokenCount(usage.promptTokens)}</span>
        <span>输出 {formatTokenCount(usage.completionTokens)}</span>
        <span>总计 {formatTokenCount(usage.totalTokens)}</span>
        {usage.reasoningTokens ? (
          <span>推理 {formatTokenCount(usage.reasoningTokens)}</span>
        ) : null}
        {usage.cachedInputTokens ? (
          <span>缓存 {formatTokenCount(usage.cachedInputTokens)}</span>
        ) : null}
      </div>
    );
  }

  function renderPart(part: MessagePart): React.JSX.Element {
    if (part.type === "text") {
      return (
        <p key={part.id} className="message-text">
          {part.text}
        </p>
      );
    }

    if (part.type === "lyrics") {
      return (
        <section key={part.id} className="artifact-card artifact-lyrics">
          <div className="artifact-head">
            <div>
              <span>歌词</span>
              <strong>{part.title}</strong>
            </div>
            <div className="artifact-tags">
              <span>{part.language}</span>
              {part.moodTags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
          <pre>{part.content}</pre>
          <div className="artifact-actions">
            <button
              type="button"
              className="ghost-action"
              onClick={() => {
                void copyText(part.content, "歌词已复制");
              }}
            >
              复制歌词
            </button>
            <button
              type="button"
              className="ghost-action"
              onClick={() => {
                queueComposerPrompt("把上一版歌词继续优化一下，保留现在的主题和意象。");
              }}
              disabled={isSending}
            >
              继续改词
            </button>
          </div>
        </section>
      );
    }

    if (part.type === "prompt") {
      return (
        <section key={part.id} className="artifact-card artifact-prompt">
          <div className="artifact-head">
            <div>
              <span>音乐 Prompt</span>
              <strong>{part.title}</strong>
            </div>
            <div className="artifact-tags">
              {part.styleTags.length > 0 ? (
                part.styleTags.map((tag) => <span key={tag}>{tag}</span>)
              ) : (
                <span>可直接生成</span>
              )}
            </div>
          </div>
          <pre>{part.content}</pre>
          {part.negativePrompt ? (
            <div className="artifact-inline-note">
              <span>避免</span>
              <p>{part.negativePrompt}</p>
            </div>
          ) : null}
          <div className="artifact-actions">
            <button
              type="button"
              className="ghost-action"
              onClick={() => {
                void copyText(part.content, "音乐 Prompt 已复制");
              }}
            >
              复制 Prompt
            </button>
            <button
              type="button"
              className="ghost-action"
              onClick={() => {
                queueComposerPrompt("把上一版 music prompt 再优化一下，让风格更聚焦一些。");
              }}
              disabled={isSending}
            >
              继续改 Prompt
            </button>
            <button
              type="button"
              className="primary-inline-action"
              onClick={() => {
                void sendMessage("基于最新歌词和 prompt 直接生成一版。");
              }}
              disabled={isSending}
            >
              直接生成
            </button>
          </div>
        </section>
      );
    }

    if (part.type === "skills") {
      return (
        <section key={part.id} className="artifact-card artifact-skills">
          <div className="artifact-head">
            <div>
              <span>本轮调用</span>
              <strong>{part.title}</strong>
            </div>
          </div>
          <div className="skills-list">
            {part.items.map((item) => (
              <span key={item} className="skill-pill">
                {getSkillLabel(item)}
              </span>
            ))}
          </div>
        </section>
      );
    }

    const hasAudio = Boolean(part.audioUrl);

    return (
      <section key={part.id} className="artifact-card artifact-audio">
        <div className="audio-card-layout">
          {part.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="audio-cover" src={part.coverImageUrl} alt={part.title} />
          ) : (
            <div className="audio-cover audio-cover-fallback">T</div>
          )}
          <div className="audio-card-main">
            <div className="artifact-head">
              <div>
                <span>音频</span>
                <strong>{part.title}</strong>
              </div>
              <div className="audio-meta-row">
                <span className={`status-pill status-${part.status}`}>
                  {getStatusLabel(part.status)}
                </span>
                <span className="provider-pill">
                  {part.providerMode === "real" ? "真实接口" : "演示接口"}
                </span>
              </div>
            </div>
            <p className="artifact-note">{part.notes}</p>
            {hasAudio ? (
              <audio controls preload="none" src={part.audioUrl || undefined} />
            ) : (
              <div className="audio-placeholder">
                {part.status === "queued"
                  ? "音频还在生成中。TUNEE 会继续自动刷新，你也可以手动刷新当前会话。"
                  : part.status === "failed"
                    ? "这次生成失败了。你可以继续改歌词、改 prompt，或者重新生成。"
                    : "当前 provider 没有返回可播放音频。"}
              </div>
            )}
            <div className="artifact-actions">
              {part.status === "queued" ? (
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => {
                    void fetchState(activeConversationId);
                  }}
                  disabled={isSending || isSwitching}
                >
                  刷新状态
                </button>
              ) : null}
              {hasAudio ? (
                <a
                  className="ghost-action link-action"
                  href={part.audioUrl || undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开音频
                </a>
              ) : null}
              {hasAudio ? (
                <a
                  className="ghost-action link-action"
                  href={part.audioUrl || undefined}
                  download
                >
                  下载
                </a>
              ) : null}
              <button
                type="button"
                className="primary-inline-action"
                onClick={() => {
                  void sendMessage("基于最新歌词和 prompt 再生成一版。");
                }}
                disabled={isSending}
              >
                再生成一版
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <main className={`chat-app-shell ${isSidebarOpen ? "sidebar-open" : ""}`}>
      <button
        type="button"
        className={`sidebar-backdrop ${isSidebarOpen ? "visible" : ""}`}
        aria-label="关闭侧边栏"
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <div className="brand-mark">T</div>
            <div>
              <p className="brand-name">TUNEE AI</p>
              <p className="brand-subtitle">你的音乐伙伴</p>
            </div>
          </div>
          <button
            type="button"
            className="mobile-close-button"
            onClick={() => setIsSidebarOpen(false)}
          >
            关闭
          </button>
        </div>

        <button
          type="button"
          className="new-chat-button"
          onClick={() => {
            void createConversation();
          }}
          disabled={isCreating || isSending}
        >
          {isCreating ? "新建中..." : "新对话"}
          <span>⌘/Ctrl+N</span>
        </button>

        <label className="sidebar-search-field">
          <span>搜索会话</span>
          <input
            ref={searchInputRef}
            value={conversationQuery}
            onChange={(event) => setConversationQuery(event.target.value)}
            placeholder="搜标题、摘要、草稿..."
          />
        </label>

        <div className="sidebar-helper-row">
          <p>{conversations.length} 个会话</p>
          <p>{Object.keys(drafts).length} 个草稿</p>
        </div>

        <div className="conversation-list">
          {filteredConversations.length === 0 ? (
            <section className="conversation-empty-state">
              <strong>没找到匹配的会话</strong>
              <p>试试搜歌名、风格词，或者按 `Esc` 清空搜索。</p>
            </section>
          ) : (
            filteredConversations.map((item) => {
              const draftText = drafts[item.id] || "";
              const previewText = draftText.trim()
                ? `草稿：${compactInlineText(draftText, 54)}`
                : item.preview || item.summary;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`conversation-item ${item.id === activeConversationId ? "active" : ""}`}
                  onClick={() => {
                    void switchConversation(item.id);
                  }}
                  disabled={isSwitching || isSending}
                >
                  <div className="conversation-item-top">
                    <strong>{item.title}</strong>
                    <span>{formatConversationTime(item.updatedAt)}</span>
                  </div>
                  <p>{previewText}</p>
                  <div className="conversation-item-badges">
                    {draftText.trim() ? <em className="badge-draft">未发送草稿</em> : null}
                    {item.hasQueuedGeneration ? <em className="badge-live">音频生成中</em> : null}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="sidebar-footer">
          <label className="sidebar-field">
            <span>模型 ID</span>
            <input
              value={modelId}
              list="model-suggestions"
              onChange={(event) => setModelId(event.target.value)}
              placeholder="gpt-5.4"
              disabled={isSending}
            />
            <datalist id="model-suggestions">
              {initialData.suggestedModels.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </label>
          <p className="sidebar-note">
            只要求最基础的 OpenAI 协议兼容。改好模型 ID 之后，下一轮消息就会按这个配置走。
          </p>
          <div className="shortcut-list">
            <span>⌘/Ctrl+K 搜索会话</span>
            <span>/ 聚焦输入框</span>
            <span>Esc 关闭侧栏 / 清空搜索</span>
          </div>
        </div>
      </aside>

      <section className="chat-stage">
        <header className="chat-stage-header">
          <div className="stage-heading">
            <div className="stage-heading-top">
              <button
                type="button"
                className="mobile-nav-button"
                onClick={() => setIsSidebarOpen(true)}
              >
                会话
              </button>
              <p className="stage-eyebrow">TUNEE</p>
              {isSending && activeTrace ? (
                <span className="stage-live-pill">正在 {activeTrace.label}</span>
              ) : null}
            </div>
            <h1>{conversation.title}</h1>
            <p className="stage-summary">
              {conversation.summary ||
                "直接告诉 TUNEE 你想做什么歌，它会在当前会话里继续推进，包括写歌词、写 prompt、记住偏好，以及生成音频。"}
            </p>
          </div>

          <div className="header-actions">
            <div className="header-badges">
              <span className={`header-pill ${mode === "live" ? "is-live" : "is-mock"}`}>
                {mode === "live" ? "在线模型" : "演示模型"}
              </span>
              <span className="header-pill">记忆 {tasteProfile.memories.length}</span>
              <span className="header-pill">
                音乐 {musicProviderMode === "real" ? "真实接口" : "演示接口"}
              </span>
            </div>
            <button
              type="button"
              className="ghost-action header-refresh-button"
              onClick={() => {
                void fetchState(activeConversationId);
              }}
              disabled={isSending || isSwitching}
            >
              刷新当前会话
            </button>
          </div>
        </header>

        {(warnings.length > 0 || error) && (
          <section className="alert-stack">
            {warnings.map((warning) => (
              <p key={warning} className="alert-item alert-warning">
                {warning}
              </p>
            ))}
            {error ? <p className="alert-item alert-error">{error}</p> : null}
          </section>
        )}

        {activeUsageEvents.length > 0 && cumulativeUsage ? (
          <section className="usage-panel">
            <div className="usage-summary-head">
              <div>
                <span className="usage-eyebrow">
                  {isSending ? "本轮 Token 消耗" : "上一轮 Token 消耗"}
                </span>
                <strong>{formatTokenCount(cumulativeUsage.totalTokens)} tokens</strong>
              </div>
              {renderUsageMetrics(cumulativeUsage)}
            </div>
            <div className="usage-step-grid">
              {activeUsageEvents.map((usageEvent) => (
                <div key={usageEvent.key} className="usage-step-card">
                  <div className="usage-step-top">
                    <strong>{getSkillLabel(usageEvent.label)}</strong>
                    <span>{formatTokenCount(usageEvent.usage.totalTokens)} tokens</span>
                  </div>
                  {renderUsageMetrics(usageEvent.usage, true)}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="chat-thread-shell">
          <div
            ref={chatScrollRef}
            className="chat-thread"
            onScroll={handleChatScroll}
          >
            {conversation.messages.length === 0 ? (
              <section className="empty-thread-card">
                <p className="empty-thread-eyebrow">从一句话开始</p>
                <h2>把 TUNEE 当成真正的音乐搭子来聊。</h2>
                <p>
                  你只需要自然地说需求。它会在当前会话里记住上下文，在需要的时候显式调用技能，并把歌词、prompt、音频都作为聊天历史的一部分留下来。
                </p>

                <div className="quick-prompt-list">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="quick-prompt"
                      onClick={() => queueComposerPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              conversation.messages.map((message) => {
                const copyableText = getPlainTextFromMessage(message);

                return (
                  <article
                    key={message.id}
                    className={`chat-bubble ${message.role === "assistant" ? "assistant" : "user"}`}
                  >
                    <div className="bubble-meta">
                      <span>{message.role === "assistant" ? "TUNEE" : "你"}</span>
                      <span>{formatConversationTime(message.createdAt)}</span>
                    </div>
                    <div className="bubble-body">{message.parts.map((part) => renderPart(part))}</div>
                    {copyableText ? (
                      <div className="bubble-actions">
                        <button
                          type="button"
                          className="ghost-action"
                          onClick={() => {
                            void copyText(
                              copyableText,
                              message.role === "assistant"
                                ? "TUNEE 回复已复制"
                                : "消息已复制"
                            );
                          }}
                        >
                          复制文本
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}

            {isSending ? (
              <article className="chat-bubble assistant pending-bubble">
                <div className="bubble-meta">
                  <span>TUNEE</span>
                  <span>{activeTrace ? `正在 ${activeTrace.label}` : "处理中"}</span>
                </div>
                <div className="bubble-body">
                  <div className="pending-toolbar">
                    <span className="pending-pill">
                      {activeTrace ? activeTrace.label : "正在整理上下文"}
                    </span>
                    {activeTrace?.key === "reply" && estimatedReplyTokens > 0 ? (
                      <span className="pending-pill">
                        回复约 {formatTokenCount(estimatedReplyTokens)} tokens
                      </span>
                    ) : null}
                    {streamTraces.length > 0 ? (
                      <button
                        type="button"
                        className="trace-toggle"
                        onClick={() => setShowTraceDetails((current) => !current)}
                      >
                        {showTraceDetails
                          ? "收起过程"
                          : `查看过程 ${completedTraceCount}/${streamTraces.length}`}
                      </button>
                    ) : null}
                  </div>
                  <p className="message-text message-text-soft streaming-text">
                    {streamedReply ||
                      "我在结合当前会话、偏好记忆，以及已有歌词 / prompt 处理你的请求。"}
                    <span className="typing-caret" aria-hidden="true" />
                  </p>
                  {showTraceDetails && streamTraces.length > 0 ? (
                    <div className="trace-list">
                      {streamTraces.map((trace) => {
                        const traceUsage = streamUsageByKey.get(trace.key);

                        return (
                          <div
                            key={trace.key}
                            className={`trace-item trace-${trace.status}`}
                          >
                            <span className="trace-dot" />
                            <div className="trace-copy">
                              <strong>{trace.label}</strong>
                              {trace.detail ? <span>{trace.detail}</span> : null}
                              {traceUsage ? (
                                <div className="trace-usage">
                                  {renderUsageMetrics(traceUsage.usage, true)}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </article>
            ) : null}
          </div>

          {!isNearBottom && conversation.messages.length > 0 ? (
            <button
              type="button"
              className="jump-to-bottom-button"
              onClick={() => scrollToBottom("smooth")}
            >
              回到最新
            </button>
          ) : null}
        </div>

        <form className="composer-shell" onSubmit={handleSubmit}>
          <div className="composer-topline">
            <p>
              {isSending
                ? `回复正在流式输出${activeTrace ? `，当前步骤：${activeTrace.label}` : ""}。`
                : composer.trim()
                  ? "草稿会自动保存在当前会话里。"
                  : "当前会话会保留上下文、多轮对话和 taste memory。"}
            </p>
            <div className="composer-shortcuts">
              <span>Enter 发送</span>
              <span>Shift+Enter 换行</span>
              <span>/ 聚焦输入框</span>
            </div>
          </div>

          <textarea
            ref={composerRef}
            value={composer}
            onChange={(event) => setComposerValue(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder="说一句，比如：帮我做一首偏 city pop 的中文女声歌，副歌要更抓耳。"
            rows={4}
            disabled={isSending}
          />

          <div className="composer-footer">
            <div className="composer-footer-copy">
              <p>
                {isSending
                  ? "处理过程会实时显示；如果正在调用 skills，也会直接显示当前步骤。"
                  : "需要开新思路时可以新建会话；需要延续当前方向，就继续在这里聊。"}
              </p>
            </div>

            <div className="composer-actions">
              <button
                type="button"
                className="ghost-action composer-clear-button"
                onClick={() => queueComposerPrompt("")}
                disabled={isSending || !composer}
              >
                清空
              </button>
              <button type="submit" disabled={isSending || !composer.trim()}>
                <span>{isSending ? "处理中..." : "发送"}</span>
                <span className="button-shortcut">Enter</span>
              </button>
            </div>
          </div>
        </form>
      </section>

      {copiedNotice ? <div className="floating-toast">{copiedNotice}</div> : null}
    </main>
  );
}
