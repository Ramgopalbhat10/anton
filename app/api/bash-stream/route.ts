import { bashProgress, type BashProgressEvent } from "@/src/lib/bash-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const streamId = searchParams.get("streamId");
  const token = searchParams.get("token");

  if (!streamId) {
    return new Response("Missing streamId", { status: 400 });
  }
  if (!token || !bashProgress.validateToken(streamId, token)) {
    return new Response("Invalid stream token", { status: 403 });
  }

  const state = bashProgress.getState(streamId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribeChunk = () => {};
      let unsubscribeEnd = () => {};
      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, HEARTBEAT_INTERVAL_MS);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribeChunk();
        unsubscribeEnd();
        controller.close();
      };

      if (state) {
        if (state.stdout) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "stdout", chunk: state.stdout })}\n\n`,
            ),
          );
        }
        if (state.stderr) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "stderr", chunk: state.stderr })}\n\n`,
            ),
          );
        }
        if (state.finished) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "exit",
                exitCode: state.exitCode ?? null,
                timedOut: state.timedOut ?? false,
                killed: state.killed ?? false,
                failedReason: state.failedReason,
                finished: true,
              })}\n\n`,
            ),
          );
          close();
          return;
        }
      }

      unsubscribeChunk = bashProgress.onChunk(
        streamId,
        (event: BashProgressEvent) => {
          if (closed) return;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );

          if (event.type === "exit") {
            setTimeout(() => {
              close();
            }, 100);
          }
        },
      );

      unsubscribeEnd = bashProgress.onEnd(streamId, () => {
        close();
      });

      req.signal.addEventListener("abort", () => {
        unsubscribeChunk();
        unsubscribeEnd();
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
