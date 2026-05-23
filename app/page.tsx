import { Chat } from "@/components/features/chat/chat";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const { chat } = await searchParams;
  return <Chat key={chat ?? "new-chat"} />;
}
