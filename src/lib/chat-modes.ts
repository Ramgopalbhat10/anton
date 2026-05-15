export const CHAT_MODES = ["chat", "ask", "plan", "agent"] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

export const DEFAULT_CHAT_MODE: ChatMode = "ask";
