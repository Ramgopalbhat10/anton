import type { UIMessageChunk } from "ai";

const CLEANUP_AFTER_MS = 60_000;

type ActiveChatStream = {
  chunks: UIMessageChunk[];
  subscribers: Set<ReadableStreamDefaultController<UIMessageChunk>>;
  finished: boolean;
  error: unknown;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const globalForChatStreams = globalThis as typeof globalThis & {
  __antonActiveChatStreams?: Map<string, ActiveChatStream>;
};

const activeChatStreams =
  globalForChatStreams.__antonActiveChatStreams ?? new Map<string, ActiveChatStream>();

globalForChatStreams.__antonActiveChatStreams = activeChatStreams;

export function registerActiveChatStream(
  sessionId: string,
  source: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
  const previous = activeChatStreams.get(sessionId);
  previous?.subscribers.forEach((subscriber) => {
    subscriber.close();
  });
  previous?.subscribers.clear();
  if (previous?.cleanupTimer) clearTimeout(previous.cleanupTimer);

  const active: ActiveChatStream = {
    chunks: [],
    subscribers: new Set(),
    finished: false,
    error: undefined,
    cleanupTimer: null,
  };
  activeChatStreams.set(sessionId, active);
  void pumpActiveStream(sessionId, active, source);

  const subscription = subscribeActiveChatStream(sessionId);
  if (!subscription) {
    throw new Error("failed to subscribe to active chat stream");
  }
  return subscription;
}

export function subscribeActiveChatStream(
  sessionId: string,
): ReadableStream<UIMessageChunk> | null {
  const active = activeChatStreams.get(sessionId);
  if (!active || active.finished) return null;
  let subscribedController:
    | ReadableStreamDefaultController<UIMessageChunk>
    | undefined;

  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of active.chunks) {
        controller.enqueue(chunk);
      }
      if (active.error !== undefined) {
        controller.error(active.error);
        return;
      }
      if (active.finished) {
        controller.close();
        return;
      }
      subscribedController = controller;
      active.subscribers.add(controller);
    },
    cancel() {
      if (subscribedController) {
        active.subscribers.delete(subscribedController);
      }
    },
  });
}

async function pumpActiveStream(
  sessionId: string,
  active: ActiveChatStream,
  source: ReadableStream<UIMessageChunk>,
): Promise<void> {
  try {
    const reader = source.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      active.chunks.push(value);
      for (const subscriber of active.subscribers) {
        subscriber.enqueue(value);
      }
    }
    active.finished = true;
    for (const subscriber of active.subscribers) {
      subscriber.close();
    }
  } catch (error) {
    active.error = error;
    active.finished = true;
    for (const subscriber of active.subscribers) {
      subscriber.error(error);
    }
  } finally {
    active.subscribers.clear();
    active.cleanupTimer = setTimeout(() => {
      if (activeChatStreams.get(sessionId) === active) {
        activeChatStreams.delete(sessionId);
      }
    }, CLEANUP_AFTER_MS);
  }
}
