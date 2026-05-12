import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyMessageListText } from "../components/features/chat/message-list";

test("empty persisted sessions stop showing the recovery loading message", () => {
  assert.equal(emptyMessageListText(true), "Loading session...");
  assert.equal(
    emptyMessageListText(false),
    "Start a session by asking Anton to inspect or change the selected workspace.",
  );
});
