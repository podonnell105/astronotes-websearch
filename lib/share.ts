import { mutate, read } from "./db";
import { remoteShare, useRemoteStore } from "./remote";
import { parseSessionView, toSessionView, type SessionRecord } from "./store";
import type { SessionView } from "./types";

export async function createShare(
  session: SessionRecord,
): Promise<{ token: string; urlPath: string }> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const view = toSessionView(session);
  view.frozenAt = view.frozenAt ?? Date.now();
  await mutate((store) => {
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

export async function getShare(token: string): Promise<SessionView | undefined> {
  if (useRemoteStore()) return (await remoteShare(token)) ?? undefined;
  const row = await read((store) => store.shares.find((item) => item.token === token));
  if (!row) return undefined;
  return parseSessionView(row.payload);
}
