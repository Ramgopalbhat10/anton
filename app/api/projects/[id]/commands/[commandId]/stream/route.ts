import {
  backgroundCommandStream,
  type BackgroundCommandStreamEvent,
} from "@/src/lib/background-command-stream";
import { getProjectBackgroundCommand } from "@/src/workspace/background-commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 15_000;

type Ctx = { params: Promise<{ id: string; commandId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id, commandId } = await params;
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token || !backgroundCommandStream.validateToken(commandId, token)) {
    return new Response("Invalid stream token", { status: 403 });
  }

  const session = getProjectBackgroundCommand(id, commandId);
  if (!session) {
    return new Response("Command session not found", { status: 404 });
  }

  const state = backgroundCommandStream.getState(commandId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribeEvent = () => {};
      let unsubscribeEnd = () => {};
      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, HEARTBEAT_INTERVAL_MS);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribeEvent();
        unsubscribeEnd();
        controller.close();
      };

      const initialStatus = state?.status ?? session.status;
      const initialFinished =
        state?.finished ??
        (initialStatus === "exited" ||
          initialStatus === "failed" ||
          initialStatus === "stopped" ||
          initialStatus === "stale");

      if (state?.stdout || session.stdoutTail) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "stdout",
              chunk: state?.stdout || session.stdoutTail,
            })}\n\n`,
          ),
        );
      }
      if (state?.stderr || session.stderrTail) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "stderr",
              chunk: state?.stderr || session.stderrTail,
            })}\n\n`,
          ),
        );
      }
      if (initialFinished) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "status",
              status: initialStatus,
              exitCode: state?.exitCode ?? session.exitCode,
              signal: state?.signal ?? session.signal,
              detectedUrls: state?.detectedUrls ?? session.detectedUrls,
              finished: true,
            })}\n\n`,
          ),
        );
        close();
        return;
      }

      unsubscribeEvent = backgroundCommandStream.onEvent(
        commandId,
        (event: BackgroundCommandStreamEvent) => {
          if (closed) return;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
          if (
            event.type === "status" &&
            (event.status === "exited" ||
              event.status === "failed" ||
              event.status === "stopped" ||
              event.status === "stale")
          ) {
            setTimeout(() => {
              close();
            }, 100);
          }
        },
      );

      unsubscribeEnd = backgroundCommandStream.onEnd(commandId, () => {
        close();
      });

      req.signal.addEventListener("abort", () => {
        unsubscribeEvent();
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
