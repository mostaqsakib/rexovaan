// Shared helper — apply a verified deposit to a customer.
// If the customer has an outstanding pay-later due, deduct that first,
// then credit any remainder to the balance. Uses atomic RPCs.
//
// Returns { paidPayLater, addedToBalance, newBalance, newPayLaterUsed }.

// deno-lint-ignore no-explicit-any
type Sb = any;

export interface ApplyDepositResult {
  paidPayLater: number;
  addedToBalance: number;
  newBalance: number;
  newPayLaterUsed: number;
}

export async function applyDepositCredit(
  supabase: Sb,
  customerId: string,
  amount: number,
): Promise<ApplyDepositResult> {
  let paidPayLater = 0;
  let newPayLaterUsed = 0;
  let remaining = amount;

  const { data: cust } = await supabase
    .from("bot_customers")
    .select("balance, pay_later_enabled, pay_later_used")
    .eq("id", customerId)
    .maybeSingle();

  const used = Number(cust?.pay_later_used || 0);
  const enabled = !!cust?.pay_later_enabled;

  if (enabled && used > 0 && remaining > 0) {
    const deduct = Math.min(used, remaining);
    const { data: refRows, error: refErr } = await supabase.rpc("refund_pay_later_credit", {
      _customer_id: customerId,
      _amount: deduct,
    });
    if (!refErr) {
      const r = Array.isArray(refRows) ? refRows[0] : refRows;
      paidPayLater = deduct;
      newPayLaterUsed = Number(r?.new_used ?? Math.max(0, used - deduct));
      remaining = amount - deduct;
    } else {
      console.error("applyDepositCredit refund_pay_later_credit err:", refErr);
      newPayLaterUsed = used;
    }
  } else {
    newPayLaterUsed = used;
  }

  let newBalance = Number(cust?.balance || 0);
  let addedToBalance = 0;
  if (remaining > 0) {
    const { data: balRows, error: balErr } = await supabase.rpc("refund_customer_balance", {
      _customer_id: customerId,
      _amount: remaining,
    });
    if (balErr) {
      console.error("applyDepositCredit refund_customer_balance err:", balErr);
    } else {
      const r = Array.isArray(balRows) ? balRows[0] : balRows;
      newBalance = Number(r?.new_balance ?? newBalance + remaining);
      addedToBalance = remaining;
    }
  }

  return { paidPayLater, addedToBalance, newBalance, newPayLaterUsed };
}
