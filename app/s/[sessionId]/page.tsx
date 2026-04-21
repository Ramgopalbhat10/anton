import { notFound } from "next/navigation";

import { Chat } from "@/components/chat/chat";
import { getSession, loadMessages } from "@/src/db/queries";
import type { AntonUIMessage } from "@/src/agent/loop";
import type { ModelId } from "@/src/lib/providers";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = getSession(sessionId);
  if (!session) notFound();

  const messages = loadMessages<AntonUIMessage>(sessionId);

  return (
    <Chat
      sessionId={session.id}
      initialMessages={messages}
      initialModel={session.model as ModelId}
      initialTitle={session.title}
      initialTokensTotal={session.tokensTotal}
    />
  );
}
