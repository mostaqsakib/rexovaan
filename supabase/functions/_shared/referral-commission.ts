// Shared helper to award referral commissions for orders created outside the bot process
// (web checkout, bKash auto-fulfill, admin-verified deposits with pending products).
// Mirrors standalone-bot/bot.js `processReferralCommission`.

export async function awardReferralCommission(
  supabase: any,
  buyerCustomerId: string,
  orderTotal: number,
  orderId: string | null,
): Promise<void> {
  try {
    if (!buyerCustomerId || !Number.isFinite(orderTotal) || orderTotal <= 0) return;

    const { data: rows } = await supabase
      .from("bot_settings")
      .select("key,value")
      .in("key", ["referral_commission_percent", "referral_first_purchase_bonus"]);
    const map: Record<string, string> = Object.fromEntries((rows || []).map((r: any) => [r.key, r.value]));
    const commissionPct = Number(map.referral_commission_percent);
    const firstBonus = Number(map.referral_first_purchase_bonus);
    // If both are zero/unset, nothing to do.
    if (!(commissionPct > 0) && !(firstBonus > 0)) return;

    const { data, error } = await supabase.rpc("process_referral_commission_atomic", {
      _buyer_customer_id: buyerCustomerId,
      _order_total: orderTotal,
      _order_id: orderId,
      _commission_percent: commissionPct > 0 ? commissionPct : 0,
      _first_bonus_amount: firstBonus > 0 ? firstBonus : 0,
    });
    if (error) { console.error("[referral-commission] RPC error:", error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.referrer_id) return;

    const commission = Number(row.commission_credited) || 0;
    const fb = Number(row.first_bonus_credited) || 0;
    const newBal = Number(row.new_referral_balance) || 0;
    const chatId = row.referrer_chat_id;

    // Best-effort Telegram notification to the referrer (only if we have BOT_TOKEN + real chat id).
    const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (BOT_TOKEN && chatId && Number(chatId) > 0) {
      const send = (text: string) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      }).catch(() => {});
      if (commission > 0) {
        await send(`💰 <b>Referral Commission!</b>\n\nYou earned <b>${commission.toFixed(2)} USDT</b> from a referral's purchase.\nAvailable Referral Balance: <b>${newBal.toFixed(2)} USDT</b>`);
      }
      if (fb > 0) {
        await send(`🎉 <b>First Purchase Bonus!</b>\n\nYou earned an extra <b>${fb.toFixed(2)} USDT</b> because your referral made their first purchase!\nAvailable Referral Balance: <b>${newBal.toFixed(2)} USDT</b>`);
      }
    }
  } catch (e) {
    console.error("[referral-commission] unexpected error:", (e as Error).message);
  }
}
