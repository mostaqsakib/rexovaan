import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_API = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;

async function tgDelete(chatId: number, messageId: number) {
  if (!TELEGRAM_API) return { ok: false, skipped: true };
  try {
    const res = await fetch(`${TELEGRAM_API}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
    return await res.json().catch(() => ({ ok: false }));
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { order_id, note } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: order, error: orderErr } = await supabase
      .from("bot_orders")
      .select("id, customer_id, total_price, status, delivery_message_ids, product_name, quantity")
      .eq("id", order_id)
      .maybeSingle();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (order.status === "refunded") {
      return new Response(JSON.stringify({ error: "Order already refunded" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Restore stock items linked to this order back to available
    const { error: restoreErr } = await supabase.rpc("restore_internal_stock_items", { _order_id: order.id });
    if (restoreErr) console.error("restore_internal_stock_items:", restoreErr);

    // 2. Refund customer balance
    const { error: refundErr } = await supabase.rpc("refund_customer_balance", {
      _customer_id: order.customer_id,
      _amount: Number(order.total_price || 0),
    });
    if (refundErr) {
      return new Response(JSON.stringify({ error: `Refund failed: ${refundErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Delete Telegram delivery messages from customer's chat
    const { data: customer } = await supabase.from("bot_customers").select("chat_id").eq("id", order.customer_id).maybeSingle();
    const msgIds: number[] = Array.isArray(order.delivery_message_ids) ? order.delivery_message_ids : [];
    let deleted = 0;
    if (customer?.chat_id && msgIds.length) {
      for (const mid of msgIds) {
        const r = await tgDelete(Number(customer.chat_id), Number(mid));
        if (r?.ok) deleted++;
      }
    }

    // 4. Mark order as refunded
    await supabase.from("bot_orders").update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      refund_note: note || null,
    }).eq("id", order.id);

    // 5. Notify customer (best-effort)
    if (customer?.chat_id && TELEGRAM_API) {
      const text = `↩️ <b>Order Refunded</b>\n\nProduct: <b>${order.product_name}</b> × ${order.quantity}\nRefunded: <b>${Number(order.total_price).toFixed(2)} USDT</b> to your balance${note ? `\n\nNote: ${note}` : ""}`;
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: customer.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, deleted_messages: deleted, total_messages: msgIds.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
