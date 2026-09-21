import {
  createAuthCookie,
  findUserByEmail,
  normalizeEmail,
  verifyPassword,
} from "@/lib/auth";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";
    const record = await findUserByEmail(email);
    if (!record || !(await verifyPassword(password, record.passwordHash))) {
      return Response.json({ error: "Invalid email or password." }, { status: 401 });
    }
    await createAuthCookie(record.id);
    return Response.json({
      user: { id: record.id, email: record.email, credits: record.credits },
    });
  } catch (error) {
    return apiError(error);
  }
}
