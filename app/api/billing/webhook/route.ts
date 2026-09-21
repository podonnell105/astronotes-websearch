import { CREDIT_PACK_SIZE, creditAccount } from "@/lib/credits";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret || !key) {
    return Response.json({ error: "Billing is not configured." }, { status: 400 });
  }
  const stripe = new Stripe(key);
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }
  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook";
    return Response.json({ error: message }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId || session.client_reference_id;
    const credits = Number(session.metadata?.credits ?? CREDIT_PACK_SIZE);
    if (userId && Number.isFinite(credits) && credits > 0) {
      creditAccount(userId, credits, "stripe_pack");
    }
  }

  return Response.json({ received: true });
}
