import { fetchInstallation } from "@/src/github/app";
import { upsertGithubInstallation } from "@/src/db/queries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const installationId = Number(url.searchParams.get("installation_id"));
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return Response.json({ error: "missing installation_id" }, { status: 400 });
  }

  try {
    const installation = await fetchInstallation(installationId);
    upsertGithubInstallation({
      installationId: installation.id,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
    });
    return Response.redirect(new URL("/?github=connected", req.url), 302);
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
