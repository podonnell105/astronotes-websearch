import { mutate, read } from "./db";
import type { AuthUser } from "./types";

export const RESEARCH_CREDIT_COST = 1;
export const CREDIT_PACK_SIZE = 20;

export class CreditError extends Error {
  status = 402;
}

export function getCredits(userId: string): number {
  return read((store) => store.users.find((user) => user.id === userId)?.credits ?? 0);
}

export function debitCredits(
  userId: string,
  amount: number,
  reason: string,
  sessionId?: string,
): AuthUser {
  return mutate((store) => {
    const row = store.users.find((user) => user.id === userId);
    if (!row) throw new CreditError("Account not found");
    if (row.credits < amount) {
      throw new CreditError("No research credits remaining");
    }
    row.credits -= amount;
    store.credit_ledger.push({
      id: crypto.randomUUID(),
      user_id: userId,
      delta: -amount,
      reason,
      session_id: sessionId ?? null,
      created_at: Date.now(),
    });
    return { id: row.id, email: row.email, credits: row.credits };
  });
}

export function creditAccount(
  userId: string,
  amount: number,
  reason: string,
  sessionId?: string,
): AuthUser {
  return mutate((store) => {
    const row = store.users.find((user) => user.id === userId);
    if (!row) throw new CreditError("Account not found");
    row.credits += amount;
    store.credit_ledger.push({
      id: crypto.randomUUID(),
      user_id: userId,
      delta: amount,
      reason,
      session_id: sessionId ?? null,
      created_at: Date.now(),
    });
    return { id: row.id, email: row.email, credits: row.credits };
  });
}

export function stripeEnabled(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_PRICE_ID?.trim(),
  );
}
