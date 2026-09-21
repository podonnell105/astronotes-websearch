import { AuthError } from "./auth";
import { CreditError } from "./credits";

export function apiError(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof CreditError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Request failed";
  return Response.json({ error: message }, { status: 500 });
}
