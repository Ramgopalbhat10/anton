import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export type BackgroundCommandStreamEvent =
  | {
      type: "stdout";
      chunk: string;
    }
  | {
      type: "stderr";
      chunk: string;
    }
  | {
      type: "status";
      status: string;
      exitCode?: number | null;
      signal?: string | null;
      detectedUrls?: string[];
    };

export interface BackgroundCommandStreamState {
  token: string;
  stdout: string;
  stderr: string;
  status: string;
  exitCode?: number | null;
  signal?: string | null;
  detectedUrls: string[];
  finished: boolean;
}

const MAX_STREAM_OUTPUT_CHARS = 64 * 1024;
const STREAM_RECONNECT_TTL_MS = 60_000;

class BackgroundCommandStreamEmitter extends EventEmitter {
  private streams = new Map<string, BackgroundCommandStreamState>();

  prepareStream(sessionId: string): string {
    const existing = this.streams.get(sessionId);
    if (existing) return existing.token;

    const token = randomUUID();
    this.streams.set(sessionId, {
      token,
      stdout: "",
      stderr: "",
      status: "starting",
      detectedUrls: [],
      finished: false,
    });
    return token;
  }

  startStream(sessionId: string, initial?: Partial<BackgroundCommandStreamState>): string {
    const token = this.streams.get(sessionId)?.token ?? randomUUID();
    this.streams.set(sessionId, {
      token,
      stdout: initial?.stdout ?? "",
      stderr: initial?.stderr ?? "",
      status: initial?.status ?? "starting",
      exitCode: initial?.exitCode,
      signal: initial?.signal,
      detectedUrls: initial?.detectedUrls ?? [],
      finished: initial?.finished ?? false,
    });
    this.emit("start", sessionId);
    return token;
  }

  emitEvent(
    sessionId: string,
    event: BackgroundCommandStreamEvent,
  ): void {
    const state = this.streams.get(sessionId);
    if (!state) return;

    if (event.type === "stdout") {
      state.stdout = capOutput(state.stdout + event.chunk);
    } else if (event.type === "stderr") {
      state.stderr = capOutput(state.stderr + event.chunk);
    } else if (event.type === "status") {
      state.status = event.status;
      state.exitCode = event.exitCode;
      state.signal = event.signal;
      if (event.detectedUrls) {
        state.detectedUrls = event.detectedUrls;
      }
      if (
        event.status === "exited" ||
        event.status === "failed" ||
        event.status === "stopped" ||
        event.status === "stale"
      ) {
        state.finished = true;
      }
    }

    this.emit(`event:${sessionId}`, event, state);
  }

  validateToken(sessionId: string, token: string): boolean {
    return this.streams.get(sessionId)?.token === token;
  }

  getState(sessionId: string): BackgroundCommandStreamState | undefined {
    return this.streams.get(sessionId);
  }

  endStream(sessionId: string): void {
    this.emit(`end:${sessionId}`);
    setTimeout(() => {
      this.streams.delete(sessionId);
    }, STREAM_RECONNECT_TTL_MS);
  }

  onEvent(
    sessionId: string,
    callback: (
      event: BackgroundCommandStreamEvent,
      state: BackgroundCommandStreamState,
    ) => void,
  ): () => void {
    const listener = (
      event: BackgroundCommandStreamEvent,
      state: BackgroundCommandStreamState,
    ) => callback(event, state);
    this.on(`event:${sessionId}`, listener);
    return () => {
      this.off(`event:${sessionId}`, listener);
    };
  }

  onEnd(sessionId: string, callback: () => void): () => void {
    const listener = () => callback();
    this.on(`end:${sessionId}`, listener);
    return () => {
      this.off(`end:${sessionId}`, listener);
    };
  }
}

function capOutput(output: string): string {
  if (output.length <= MAX_STREAM_OUTPUT_CHARS) return output;
  return output.slice(output.length - MAX_STREAM_OUTPUT_CHARS);
}

const globalForBackgroundCommandStream = globalThis as typeof globalThis & {
  __antonBackgroundCommandStream?: BackgroundCommandStreamEmitter;
};

export const backgroundCommandStream =
  globalForBackgroundCommandStream.__antonBackgroundCommandStream ??
  new BackgroundCommandStreamEmitter();

globalForBackgroundCommandStream.__antonBackgroundCommandStream =
  backgroundCommandStream;
