import {
  getProject,
  getRunById,
  getRunContextSummaryByRunId,
  getRunForProject,
  listAssistantTurnRunIds,
  listRunEventsForRun,
  listToolApprovalsForRun,
  listToolCallsForRun,
} from "@/src/db/queries";
import { serializeProjectRunDetails } from "@/src/lib/run-details-serializers";
import { redactText } from "@/src/lib/redaction";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; runId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, runId } = await params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  if (project.status !== "ready") {
    return Response.json({ error: "project is not ready" }, { status: 400 });
  }

  const run = getRunForProject(project.id, runId);
  if (!run) {
    return Response.json({ error: "run not found" }, { status: 404 });
  }

  try {
    const segmentRunIds = listAssistantTurnRunIds(run.sessionId, run.id);
    const segmentRuns = segmentRunIds.flatMap((id) => {
      const segmentRun = getRunById(id);
      return segmentRun ? [segmentRun] : [];
    });
    const events = segmentRunIds
      .flatMap((id) => listRunEventsForRun(id))
      .sort((left, right) => {
        const startedDelta =
          left.startedAt.getTime() - right.startedAt.getTime();
        if (startedDelta !== 0) return startedDelta;
        return left.sequence - right.sequence;
      });
    const toolCalls = segmentRunIds.flatMap((id) => listToolCallsForRun(id));
    const approvals = segmentRunIds.flatMap((id) =>
      listToolApprovalsForRun(id),
    );

    const details = serializeProjectRunDetails({
      run,
      segmentRuns,
      events,
      toolCalls,
      approvals,
      context: getRunContextSummaryByRunId(run.id),
    });
    return Response.json({ details });
  } catch (err) {
    return Response.json(
      { error: redactText(errorMessage(err)) },
      { status: 500 },
    );
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
