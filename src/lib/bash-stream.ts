import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export type BashFailedReason = "timeout" | "killed" | "max_buffer" | "error";

const MAX_STREAM_OUTPUT_CHARS = 64 * 1024;
const STREAM_RECONNECT_TTL_MS = 60_000;

export type BashProgressEvent =
  | {
      type: "stdout";
      chunk: string;
    }
  | {
      type: "stderr";
      chunk: string;
    }
  | {
      type: "exit";
      exitCode: number | null;
      timedOut: boolean;
      killed: boolean;
      failedReason?: BashFailedReason;
    };

export interface BashStreamState {
  token: string;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  timedOut?: boolean;
  killed?: boolean;
  failedReason?: BashFailedReason;
  finished: boolean;
}

class BashProgressEmitter extends EventEmitter {
  private streams = new Map<string, BashStreamState>();

  prepareStream(toolCallId: string): string {
    const existing = this.streams.get(toolCallId);
    if (existing) return existing.token;

    const token = randomUUID();
    this.streams.set(toolCallId, {
      token,
      stdout: "",
      stderr: "",
      finished: false,
    });
    return token;
  }

  startStream(toolCallId: string): void {
    const token = this.streams.get(toolCallId)?.token ?? randomUUID();
    this.streams.set(toolCallId, {
      token,
      stdout: "",
      stderr: "",
      finished: false,
    });
    this.emit("start", toolCallId);
  }

  emitChunk(
    toolCallId: string,
    event: BashProgressEvent,
  ): void {
    const state = this.streams.get(toolCallId);
    if (!state) return;

    if (event.type === "stdout") {
      state.stdout = capOutput(state.stdout + event.chunk);
    } else if (event.type === "stderr") {
      state.stderr = capOutput(state.stderr + event.chunk);
    } else if (event.type === "exit") {
      state.exitCode = event.exitCode;
      state.timedOut = event.timedOut;
      state.killed = event.killed;
      state.failedReason = event.failedReason;
      state.finished = true;
    }

    this.emit(`chunk:${toolCallId}`, event, state);
  }

  validateToken(toolCallId: string, token: string): boolean {
    return this.streams.get(toolCallId)?.token === token;
  }

  getState(toolCallId: string): BashStreamState | undefined {
    return this.streams.get(toolCallId);
  }

  endStream(toolCallId: string): void {
    this.emit(`end:${toolCallId}`);
    setTimeout(() => {
      this.streams.delete(toolCallId);
    }, STREAM_RECONNECT_TTL_MS);
  }

  onChunk(
    toolCallId: string,
    callback: (event: BashProgressEvent, state: BashStreamState) => void,
  ): () => void {
    const listener = (event: BashProgressEvent, state: BashStreamState) =>
      callback(event, state);
    this.on(`chunk:${toolCallId}`, listener);
    return () => {
      this.off(`chunk:${toolCallId}`, listener);
    };
  }

  onEnd(toolCallId: string, callback: () => void): () => void {
    const listener = () => callback();
    this.on(`end:${toolCallId}`, listener);
    return () => {
      this.off(`end:${toolCallId}`, listener);
    };
  }
}

function capOutput(output: string): string {
  if (output.length <= MAX_STREAM_OUTPUT_CHARS) return output;
  return output.slice(output.length - MAX_STREAM_OUTPUT_CHARS);
}

const globalForBashProgress = globalThis as typeof globalThis & {
  __antonBashProgress?: BashProgressEmitter;
};

export const bashProgress =
  globalForBashProgress.__antonBashProgress ?? new BashProgressEmitter();

globalForBashProgress.__antonBashProgress = bashProgress;
