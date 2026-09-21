import {
  createAuthCookie,
  createUser,
  findUserByEmail,
  normalizeEmail,
  validateCredentials,
} from "@/lib/auth";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";
    const invalid = validateCredentials(email, password);
    if (invalid) return Response.json({ error: invalid }, { status: 400 });
    if (findUserByEmail(email)) {
      return Response.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    const user = await createUser(email, password);
    await createAuthCookie(user.id);
    return Response.json({ user });
  } catch (error) {
    return apiError(error);
  }
}
