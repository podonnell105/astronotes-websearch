import { mutate, read } from "./db";
import { parseSessionView, toSessionView, type SessionRecord } from "./store";
import type { SessionView } from "./types";

export function createShare(session: SessionRecord): { token: string; urlPath: string } {
  const token = crypto.randomUUID().replace(/-/g, "");
  const view = toSessionView(session);
  view.frozenAt = view.frozenAt ?? Date.now();
  mutate((store) => {
    store.shares.push({
      token,
      session_id: session.id,
      user_id: session.userId,
      created_at: Date.now(),
      payload: JSON.stringify(view),
    });
  });
  return { token, urlPath: `/s/${token}` };
}

export function getShare(token: string): SessionView | undefined {
  const row = read((store) => store.shares.find((item) => item.token === token));
  if (!row) return undefined;
  return parseSessionView(row.payload);
}
