import { githubInstallUrl } from "@/src/github/app";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.redirect(githubInstallUrl(), 302);
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
