import { handleWebhook } from "@/lib/server/billing";

// Stripe webhooks of the Ronde cloud: the raw body is needed to check the signature
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const status = await handleWebhook(await req.text(), req.headers.get("stripe-signature") ?? "");
  return new Response(null, { status });
}
