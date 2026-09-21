import { requireUser } from "@/lib/auth";
import { CREDIT_PACK_SIZE, stripeEnabled } from "@/lib/credits";
import { apiError } from "@/lib/http";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!stripeEnabled()) {
      return Response.json({ error: "Billing is not configured." }, { status: 400 });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const origin =
      process.env.FRONTEND_ORIGIN?.trim().replace(/\/$/, "") ||
      new URL(request.url).origin;
    const pack = Number(process.env.STRIPE_CREDIT_PACK ?? CREDIT_PACK_SIZE);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_PRICE_ID as string, quantity: 1 }],
      success_url: `${origin}/?credits=success`,
      cancel_url: `${origin}/?credits=cancel`,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        credits: String(Number.isFinite(pack) && pack > 0 ? pack : CREDIT_PACK_SIZE),
      },
    });
    return Response.json({ url: session.url });
  } catch (error) {
    return apiError(error);
  }
}
