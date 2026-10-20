// Recebe os avisos (webhooks) da Kiwify e atualiza a assinatura da clínica.
// Autenticação: a Kiwify assina o corpo com HMAC-SHA1 usando o token do webhook
// e envia no parâmetro ?signature=. O token fica só aqui, como segredo do servidor.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function hmacSha1Hex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const STATUS: Record<string, string> = {
  order_approved: "ativa",
  compra_aprovada: "ativa",
  subscription_renewed: "ativa",
  paid: "ativa",
  approved: "ativa",
  subscription_late: "atrasada",
  subscription_canceled: "cancelada",
  order_refunded: "reembolsada",
  compra_reembolsada: "reembolsada",
  refunded: "reembolsada",
  chargeback: "chargeback",
  chargedback: "chargeback",
};

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const TOKEN = Deno.env.get("KIWIFY_WEBHOOK_TOKEN") ?? "";
  // Verificação de configuração: informa só se o token existe, nunca o valor.
  if (req.method === "GET") return json({ service: "retoma-kiwify-webhook", token_configured: TOKEN.length > 0 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!TOKEN) return new Response("webhook token not configured", { status: 503 });

  const url = new URL(req.url);
  const sig = (url.searchParams.get("signature") ?? req.headers.get("x-kiwify-signature") ?? "").toLowerCase();
  const raw = await req.text();
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response("invalid json", { status: 400 }); }

  let ok = false;
  if (sig) {
    for (const candidate of [raw, JSON.stringify(body)]) {
      if (safeEq(await hmacSha1Hex(TOKEN, candidate), sig)) { ok = true; break; }
    }
  }

  const event = String(body?.webhook_event_type ?? body?.event ?? body?.order_status ?? "").toLowerCase();
  const email = String(body?.Customer?.email ?? body?.customer?.email ?? "").trim().toLowerCase();
  const orderId = body?.order_id ?? body?.id ?? null;

  await sb.from("billing_events").insert({ event, email: email || null, order_id: orderId, signature_ok: ok, payload: body });

  if (!ok) return new Response("invalid signature", { status: 401 });
  const status = STATUS[event];
  if (!status || !email) return new Response("ignored", { status: 200 });

  const sub = body?.Subscription ?? body?.subscription ?? {};
  // deno-lint-ignore no-explicit-any
  const row: Record<string, any> = {
    email,
    status,
    plan_name: sub?.plan?.name ?? body?.Product?.product_offer_name ?? body?.Product?.product_name ?? null,
    product_id: body?.Product?.product_id ?? null,
    product_name: body?.Product?.product_name ?? null,
    kiwify_order_id: orderId,
    kiwify_subscription_id: body?.subscription_id ?? sub?.id ?? null,
    last_event: event,
    updated_at: new Date().toISOString(),
  };
  const next = sub?.next_payment ?? sub?.charges?.future?.[0]?.charge_date ?? null;
  if (next) {
    const d = new Date(next);
    if (!isNaN(d.getTime())) row.access_until = d.toISOString();
  }

  const { error } = await sb.from("subscriptions").upsert(row, { onConflict: "email" });
  if (error) return new Response("db error", { status: 500 });
  return new Response("ok", { status: 200 });
});
