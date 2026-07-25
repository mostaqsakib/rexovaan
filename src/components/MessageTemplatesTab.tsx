import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Save, MessageSquare, Info, RotateCcw, Sparkles, X } from 'lucide-react';
import { TelegramEditor } from '@/components/telegram-editor';
import EmojiPicker from '@/components/telegram-editor/EmojiPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TgEmoji, TelegramRichText } from '@/components/TelegramRichText';

// Sample values for {placeholders} so the preview looks realistic
const SAMPLE_VARS: Record<string, string> = {
  name: 'Rakib', id: '123456789', balance: '25.40', joined: '2025-01-14',
  ref_24h: '3', ref_7d: '12', ref_total: '48', earned: '14.20', available: '6.80',
  transferred: '7.40', commission: '5', bonus: '0.50',
  link: 'https://t.me/RexovaanShoppieBot?start=ref_123',
  amount: '10', address: '0xA1b2C3d4E5f6789012345678901234567890AbCd',
  expires_min: '30', memo: 'REX-8842', amount_ltc: '0.0842', amount_usd: '10.00', rate: '118.76',
  product: '📦 Netflix 1 Month Premium', quantity: '2', price: '4.50', total: '9.00',
  currency: 'USDT', subtotal: '9.00', final: '9.00', after: '16.40',
  balance_section: '\n💰 Balance: <b>25.40 USDT</b>', payment_hint: '\n\n💳 Choose payment below', pay_later_section: '',
  added: '25', stock: '48', bulk_pricing: '\n📦 5+ = 4.20 USDT each',
  description: 'Fresh premium accounts, warranty included.',
  old_price: '5.00', new_price: '4.50', savings: '0.50', original: '5.00', countdown: '00:14:32',
  old_balance: '25.40', new_balance: '35.40', diff: '10.00', abs_diff: '10.00',
  note: 'Manual top-up from admin.', txid: '0xabc123def456', txid_block: '\n🔗 TxID: <code>0xabc…456</code>',
  reason: 'Amount mismatch.', reason_block: '\n\n📝 Reason: Amount mismatch.',
  pay_later: '', pay_later_block: '', payment_details: 'BEP20: 0xA1b2…AbCd',
  note_block: '\n\n📝 Note: Processed successfully.',
  special: '3.80', regular: '4.50', savings_block: '\n💸 You save: 0.70 USDT',
  moq: '5', moq_block: '\n📦 Min order: 5', products: '3 products',
  count: '3', payment: 'bKash', customer: '@rakib_bd', payment_method: 'bKash Personal',
};

function fillTemplate(tpl: string): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in SAMPLE_VARS ? SAMPLE_VARS[k] : `{${k}}`));
}

// ---- Template registry (matches standalone-bot/bot.js) ----
type Section = {
  group: string;
  key: string;
  title: string;
  desc?: string;
  default: string;
  placeholders?: string; // hint text
  buttons?: string[];    // button_key list in bot_button_emojis
};

const SECTIONS: Section[] = [
  // ─── Main Flow ───
  {
    group: 'Main Flow', key: 'welcome_message', title: '1. Welcome / Main Menu',
    desc: 'User /start dile ei msg + main menu buttons ashe.',
    default: `✨ <b>Welcome to Rexovaan Shop!</b> ✨\n\n🛒 <b>Shop</b> — Browse & buy products\n💳 <b>Deposit</b> — Add funds to your wallet\n👤 <b>My Profile</b> — Balance, orders & settings\n🆘 <b>Support</b> — Get help\n🎁 <b>Refer & Earn</b> — Invite friends & earn rewards`,
    placeholders: '{name} — User first name',
    buttons: ['menu_shop', 'menu_deposit', 'menu_balance', 'menu_profile', 'menu_orders', 'menu_referral', 'menu_support', 'menu_withdraw', 'admin_panel'],
  },
  {
    group: 'Main Flow', key: 'msg_shop', title: '2. Shop — Product List',
    default: `🛒 <b>Available Products:</b>`,
    buttons: ['product_item', 'back'],
  },
  {
    group: 'Main Flow', key: 'msg_balance', title: '3. Balance',
    default: `💰 <b>Your Balance:</b> {balance} USDT`,
    placeholders: '{balance} — Current balance',
    buttons: ['top_up_wallet', 'back'],
  },
  {
    group: 'Main Flow', key: 'msg_profile', title: '4. Profile',
    default: `👤 <b>User Profile</b>\n\n🆔 <b>ID:</b> {id}\n💰 <b>Balance:</b> {balance} USDT\n📅 <b>Joined:</b> {joined}`,
    placeholders: '{id} • {balance} • {joined}',
    buttons: ['profile_orders', 'profile_notifications', 'profile_stats', 'back'],
  },
  {
    group: 'Main Flow', key: 'msg_notifications', title: '5. Notification Preferences',
    default: `🔔 <b>Notifications</b>\n\nCustomize your notification preferences:`,
    buttons: ['notif_stock', 'notif_info', 'notif_referral', 'back'],
  },
  {
    group: 'Main Flow', key: 'msg_referral', title: '6. Referral',
    default: `🎁 <b>Refer & Earn</b>\n\n👥 Referred (24h): {ref_24h}\n👥 Referred (7d): {ref_7d}\n👥 Referred (Total): {ref_total}\n\n💰 Total Earned: <b>{earned} USDT</b>\n💵 Available: <b>{available} USDT</b>\n🔄 Transferred: <b>{transferred} USDT</b>\n\n<b>Your Referral Link:</b>\n<code>{link}</code>`,
    placeholders: '{link} {ref_24h} {ref_7d} {ref_total} {earned} {available} {transferred} {commission} {bonus}',
    buttons: ['ref_copy', 'share_link', 'ref_transfer', 'back'],
  },
  {
    group: 'Main Flow', key: 'msg_support', title: '7. Support',
    default: `🆘 <b>Need Help?</b>\n\nContact our support team directly:`,
    buttons: ['contact_support', 'back'],
  },

  // ─── Deposit Flow ───
  {
    group: 'Deposit Flow', key: 'msg_deposit', title: '8. Deposit — Method Chooser',
    default: `💳 <b>Deposit USDT</b>\n\n💡 You can send <b>any amount</b> — it will be added to your balance.\n\nSelect a payment method below:`,
    placeholders: '{balance}',
    buttons: ['bkash', 'deposit_method', 'back'],
  },
  {
    group: 'Deposit Flow', key: 'bep20_amount_msg', title: '9. BEP20 — Amount Prompt',
    default: `🟡 <b>USDT/USDC BEP20 (Auto-Verify)</b>\n\n💵 Enter amount to deposit in <b>USDT/USDC</b> (example: <code>10</code>).\n<i>Minimum: 1 USDT</i>\n\nYou'll get a <b>unique BSC address</b> just for this deposit.`,
    buttons: ['bep20_back_menu', 'custom_amount'],
  },
  {
    group: 'Deposit Flow', key: 'bep20_address_msg', title: '10. BEP20 — Address / QR Page',
    default: `🟡 <b>USDT/USDC BEP20 — Auto-Verify</b>\n\n💵 Amount: <b>{amount} USDT/USDC</b>\n⏱ Expires in: <b>{expires_min} min</b>\n\n📥 <b>Send to this address (BSC / BEP20):</b>\n<code>{address}</code>\n<i>👆 Tap to copy</i>\n\n✅ USDT or USDC — both accepted.\n⚠️ <b>BEP20 only.</b> Wrong network = lost funds.`,
    placeholders: '{amount} {address} {expires_min}',
    buttons: ['bep20_check_status', 'bep20_back_menu'],
  },
  {
    group: 'Deposit Flow', key: 'polygon_amount_msg', title: '11. Polygon — Amount Prompt',
    default: `🟣 <b>USDT/USDC Polygon (Auto-Verify)</b>\n\n💵 Enter amount to deposit in <b>USDT/USDC</b> (example: <code>10</code>).\n<i>Minimum: 0.01 USDT</i>\n\nYou'll get a <b>unique Polygon address</b> just for this deposit.`,
    buttons: ['polygon_back_menu', 'custom_amount'],
  },
  {
    group: 'Deposit Flow', key: 'polygon_address_msg', title: '12. Polygon — Address / QR Page',
    default: `🟣 <b>USDT/USDC Polygon — Auto-Verify</b>\n\n💵 Amount: <b>{amount} USDT/USDC</b>\n⏱ Expires in: <b>{expires_min} min</b>\n\n📥 <b>Send to this address (Polygon / MATIC):</b>\n<code>{address}</code>\n<i>👆 Tap to copy</i>\n\n✅ USDT or USDC — both accepted.\n⚠️ <b>Polygon network only.</b> Wrong network = lost funds.`,
    placeholders: '{amount} {address} {expires_min}',
    buttons: ['polygon_back_menu'],
  },
  {
    group: 'Deposit Flow', key: 'ton_amount_msg', title: '13. TON — Amount Prompt',
    default: `💎 <b>USDT TON (Auto-Verify)</b>\n\n💵 Enter amount to deposit in <b>USDT</b> (example: <code>10</code>).\n<i>Minimum: 0.01 USDT</i>\n\nYou'll get the deposit <b>address + a unique memo/comment</b>.`,
    buttons: ['ton_back_menu', 'custom_amount'],
  },
  {
    group: 'Deposit Flow', key: 'ton_address_msg', title: '14. TON — Address / Memo Page',
    default: `💎 <b>USDT TON — Auto-Verify</b>\n\n💵 Amount: <b>{amount} USDT</b>\n⏱ Expires in: <b>{expires_min} min</b>\n\n📥 <b>Send USDT (TON Jetton) to:</b>\n<code>{address}</code>\n\n🆔 <b>Memo / Comment (REQUIRED):</b>\n<code>{memo}</code>\n<i>👆 Both fields must match exactly.</i>`,
    placeholders: '{amount} {address} {memo} {expires_min}',
    buttons: ['ton_back_menu'],
  },
  {
    group: 'Deposit Flow', key: 'ltc_amount_msg', title: '15. LTC — Amount Prompt',
    default: `Ł <b>Litecoin (Auto-Verify)</b>\n\n💵 Enter amount to deposit in <b>USD</b> (example: <code>10</code>).\n<i>Minimum: $0.01</i>\n\nYou'll get a <b>unique LTC address</b> just for this deposit + the exact LTC amount at current rate.`,
    buttons: ['ltc_back_menu', 'custom_amount'],
  },
  {
    group: 'Deposit Flow', key: 'ltc_address_msg', title: '16. LTC — Address / QR Page',
    default: `Ł <b>Litecoin — Auto-Verify</b>\n\n💵 Amount: <b>{amount_ltc} LTC</b> (~${'$'}{amount_usd})\n📊 Rate: 1 LTC = ${'$'}{rate}\n⏱ Expires in: <b>{expires_min} min</b>\n\n📥 <b>Send this EXACT LTC amount to:</b>\n<code>{address}</code>\n<i>👆 Tap to copy</i>\n\n⚠️ <b>Send exactly {amount_ltc} LTC.</b> Underpay = not credited.\n⚠️ <b>Litecoin network only.</b>`,
    placeholders: '{amount_ltc} {amount_usd} {rate} {address} {expires_min}',
    buttons: ['ltc_back_menu'],
  },

  // ─── Order Flow ───
  {
    group: 'Order Flow', key: 'msg_order_summary', title: '17. Order Summary',
    default: `📋 <b>Order Summary</b>\n\n{product}\n🔢 Qty: <b>{quantity}</b>\n💵 Price: <b>\${price}</b> each\n💰 Total: <b>\${total} {currency}</b>{balance_section}{payment_hint}{pay_later_section}`,
    placeholders: '{product} {quantity} {price} {total} {currency} {balance_section} {payment_hint} {pay_later_section}',
    buttons: ['confirm_payment', 'change_quantity', 'cancel_order', 'pay_later'],
  },
  {
    group: 'Order Flow', key: 'msg_pay_balance_confirm', title: '18. Pay with Balance — Confirm',
    default: `💰 <b>Pay with Balance</b>\n\n{product}\n🔢 Quantity: <b>{quantity}</b>\n🧾 Subtotal: <b>{subtotal} {currency}</b>\n💵 Final: <b>{final} {currency}</b>\n\n💰 Balance: <b>{balance}</b>\n📊 After: <b>{after}</b>\n\n<b>Confirm balance deduction?</b>`,
    placeholders: '{product} {quantity} {subtotal} {final} {balance} {after} {currency} {price}',
    buttons: ['pay_balance_confirm', 'pay_balance_cancel'],
  },
  {
    group: 'Order Flow', key: 'msg_withdraw', title: '19. Withdraw',
    default: `💸 <b>Withdraw Funds</b>\n\nYour Balance: <b>{balance} USDT</b>\n\nEnter the amount you want to withdraw:`,
    placeholders: '{balance}',
    buttons: ['back'],
  },

  // ─── Auto Broadcasts ───
  {
    group: 'Auto Broadcasts', key: 'msg_keyword_reply', title: '20. Keyword Reply (Groups)',
    default: `✅ <b>Available now!</b> Tap below to buy:`,
    placeholders: '{product} {products} {count}',
    buttons: ['buy_now'],
  },
  {
    group: 'Auto Broadcasts', key: 'msg_stock_alert', title: '21. Stock Alert',
    default: `📢 <b>{added} new stock added for {product}!</b>\n\n📊 Available: <b>{stock}</b> items\n💰 Price: <b>{price} USDT</b>{bulk_pricing}`,
    placeholders: '{product} {added} {stock} {price} {bulk_pricing}',
    buttons: ['buy_now', 'stock_alert'],
  },
  {
    group: 'Auto Broadcasts', key: 'msg_new_product', title: '22. New Product Alert',
    default: `🆕 <b>New Product Available!</b>\n\n📦 <b>{product}</b>\n💰 Price: <b>{price} USDT</b>\n📊 Stock: <b>{stock}</b>`,
    placeholders: '{product} {price} {stock} {description}',
    buttons: ['buy_now', 'new_product'],
  },
  {
    group: 'Auto Broadcasts', key: 'msg_price_up', title: '23. Price Increased',
    default: `📈 <b>Price Increased</b>\n\n📦 <b>{product}</b>\n💰 Old: <s>{old_price} USDT</s>\n💎 New: <b>{new_price} USDT</b>{bulk_pricing}`,
    placeholders: '{product} {old_price} {new_price} {bulk_pricing}',
    buttons: ['buy_now'],
  },
  {
    group: 'Auto Broadcasts', key: 'msg_price_down', title: '24. Price Drop',
    default: `📉 <b>Price Drop!</b>\n\n📦 <b>{product}</b>\n💰 Was: <s>{old_price} USDT</s>\n🔥 Now: <b>{new_price} USDT</b>{bulk_pricing}`,
    placeholders: '{product} {old_price} {new_price} {bulk_pricing}',
    buttons: ['buy_now'],
  },
  {
    group: 'Auto Broadcasts', key: 'msg_flash_sale', title: '25. Flash Sale',
    default: `🔥 <b>FLASH SALE — LIMITED TIME!</b>\n\n{product}\n\n💰 Sale Price: <b>\${price}</b>\n<s>Regular: \${original}</s> — Save \${savings}\n\n⏳ Ends in: <b><code>{countdown}</code></b>`,
    placeholders: '{product} {price} {original} {savings} {countdown}',
    buttons: ['buy_now'],
  },
  {
    group: 'Auto Broadcasts', key: 'msg_flash_sale_ended', title: '26. Flash Sale Ended',
    default: `⏰ <b>FLASH SALE ENDED</b>\n\n{product}\n\n<i>This limited-time offer has expired.</i>`,
    placeholders: '{product}',
  },
  {
    group: 'Auto Broadcasts', key: 'msg_recent_sale', title: '27. Recent Sale — Bot',
    default: `🛒 Someone just bought <b>{quantity}× {product}</b>`,
    placeholders: '{product} {quantity}',
  },
  {
    group: 'Auto Broadcasts', key: 'msg_recent_sale_web', title: '28. Recent Sale — Web',
    default: `🛍️ Someone just bought <b>{quantity}× {product}</b> from the website`,
    placeholders: '{product} {quantity}',
  },

  // ─── Admin Notifications (edge functions) ───
  {
    group: 'Admin Notifications', key: 'notif_balance_credit', title: '29. Balance Credit',
    desc: 'Admin credits balance manually.',
    default: `💰 <b>Balance Credited</b>\n\nPrevious: <b>{old_balance} USDT</b>\nNew: <b>{new_balance} USDT</b>\nChange: <b>+{diff} USDT</b>\n\n📝 <b>Note:</b> {note}`,
    placeholders: '{old_balance} {new_balance} {diff} {abs_diff} {note} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_balance_debit', title: '30. Balance Debit',
    desc: 'Admin deducts balance manually.',
    default: `💸 <b>Balance Debited</b>\n\nPrevious: <b>{old_balance} USDT</b>\nNew: <b>{new_balance} USDT</b>\nChange: <b>{diff} USDT</b>\n\n📝 <b>Note:</b> {note}`,
    placeholders: '{old_balance} {new_balance} {diff} {abs_diff} {note} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_balance_adjust', title: '31. Balance Adjust (no change)',
    default: `ℹ️ <b>Balance Adjusted</b>\n\nPrevious: <b>{old_balance} USDT</b>\nNew: <b>{new_balance} USDT</b>\n\n📝 <b>Note:</b> {note}`,
    placeholders: '{old_balance} {new_balance} {note} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_deposit_verified', title: '32. Deposit Verified',
    default: `✅ <b>Deposit Verified by Admin!</b>\n\nAmount: <b>{amount} USDT</b>{pay_later_block}\nNew Balance: <b>{new_balance} USDT</b>`,
    placeholders: '{amount} {new_balance} {pay_later} {pay_later_block} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_deposit_rejected', title: '33. Deposit Rejected',
    default: `❌ <b>Deposit Rejected</b>\n\nYour deposit{txid_block} has been rejected by admin.{reason_block}\n\nIf you believe this is an error, please contact support.`,
    placeholders: '{amount} {txid} {txid_block} {reason} {reason_block} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_payment_verified_manual', title: '34. Manual Delivery Order Placed',
    default: `✅ <b>Payment Verified & Order Placed!</b>\n\nProduct: <b>{product}</b>\nQuantity: <b>{quantity}</b>\nTotal: <b>{total} {currency}</b>\n\n⏳ <b>Your order is being processed.</b>\nAdmin will deliver it manually.`,
    placeholders: '{product} {quantity} {total} {currency}',
  },
  {
    group: 'Admin Notifications', key: 'notif_refund', title: '35. Order Refund',
    default: `↩️ <b>Order Refunded</b>\n\nProduct: <b>{product}</b> × {quantity}\nRefunded: <b>{amount} USDT</b> to your balance{note_block}`,
    placeholders: '{product} {quantity} {amount} {note} {note_block} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_withdrawal_confirmed', title: '36. Withdrawal Confirmed',
    default: `✅ <b>Withdrawal Completed!</b>\n\nAmount: <b>{amount} USDT</b>\nPayment Details: <b>{payment_details}</b>{note_block}`,
    placeholders: '{amount} {payment_details} {note} {note_block} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_withdrawal_rejected', title: '37. Withdrawal Rejected',
    default: `❌ <b>Withdrawal Rejected</b>\n\nYour withdrawal request of <b>{amount} USDT</b> has been rejected.\nThe amount has been returned to your balance.\n\n💰 Current Balance: <b>{new_balance} USDT</b>{reason_block}\n\nContact support if you have questions.`,
    placeholders: '{amount} {new_balance} {reason} {reason_block} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_special_price_set', title: '38. Special Price — Set',
    default: `🎁 <b>Special Price Unlocked</b>\n\nProduct: <b>{product}</b>\nYour Price: <b>{special} USDT</b>{savings_block}\nRegular: <s>{regular} USDT</s>{moq_block}{note_block}`,
    placeholders: '{product} {special} {regular} {savings} {savings_block} {moq} {moq_block} {note} {note_block} {name}',
  },
  {
    group: 'Admin Notifications', key: 'notif_special_price_updated', title: '39. Special Price — Updated',
    default: `🔄 <b>Special Price Updated</b>\n\nProduct: <b>{product}</b>\nNew Price: <b>{special} USDT</b>{savings_block}\nRegular: <s>{regular} USDT</s>{moq_block}`,
    placeholders: '{product} {special} {regular} {savings_block} {moq_block}',
  },
  {
    group: 'Admin Notifications', key: 'notif_special_price_enabled', title: '40. Special Price — Re-Enabled',
    default: `✅ <b>Special Price Re-Enabled</b>\n\nProduct: <b>{product}</b>\nYour Price: <b>{special} USDT</b>`,
    placeholders: '{product} {special}',
  },
  {
    group: 'Admin Notifications', key: 'notif_special_price_disabled', title: '41. Special Price — Paused',
    default: `⏸️ <b>Special Price Paused</b>\n\nProduct: <b>{product}</b>\nYou will now see the regular price: <b>{regular} USDT</b>`,
    placeholders: '{product} {regular}',
  },
  {
    group: 'Admin Notifications', key: 'notif_special_price_removed', title: '42. Special Price — Removed',
    default: `❌ <b>Special Price Removed</b>\n\nProduct: <b>{product}</b>\nYou will now see the regular price: <b>{regular} USDT</b>`,
    placeholders: '{product} {regular}',
  },
  {
    group: 'Admin Notifications', key: 'admin_notif_order_delivered', title: '43. Admin Group — Order Delivered',
    desc: 'Sent to admin group when a bKash / manual deposit order is delivered.',
    default: `💰 <b>{payment} Order Delivered</b>\n\n👤 {customer}\n📦 Product: <b>{product}</b>\n🔢 Quantity: <b>{quantity}</b>\n💵 Total: <b>{total} {currency}</b>\n💳 Payment: <b>{payment_method}</b>\n🔗 TxID: <code>{txid}</code>`,
    placeholders: '{payment} {customer} {product} {quantity} {total} {currency} {payment_method} {txid}',
  },
];

const GROUPS = ['Main Flow', 'Deposit Flow', 'Order Flow', 'Auto Broadcasts', 'Admin Notifications'];

// ---- Button row (label + emoji ID) ----
type ButtonRow = { id: string; button_key: string; button_label: string; custom_emoji_id: string | null };

function ButtonEditor({ row, onChanged }: { row: ButtonRow; onChanged: () => void }) {
  const [label, setLabel] = useState(row.button_label);
  const [emojiId, setEmojiId] = useState(row.custom_emoji_id || '');
  const [saving, setSaving] = useState(false);
  const dirty = label !== row.button_label || (emojiId || null) !== (row.custom_emoji_id || null);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('bot_button_emojis')
      .update({ button_label: label, custom_emoji_id: emojiId || null })
      .eq('id', row.id);
    setSaving(false);
    if (error) toast.error('Button save failed');
    else { toast.success('Button updated'); onChanged(); }
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{row.button_key}</Badge>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Button label" className="h-8 text-sm" />
      </div>
      <div className="flex items-center gap-1.5">
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0 shrink-0" title="Pick premium emoji">
              {emojiId ? <TgEmoji id={emojiId} size="1.1em" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="p-0 w-auto border-0 bg-transparent shadow-none">
            <EmojiPicker
              onPickUnicode={() => { /* premium only for buttons */ }}
              onPickCustom={(id) => setEmojiId(id)}
            />
          </PopoverContent>
        </Popover>
        <Input
          value={emojiId}
          onChange={(e) => setEmojiId(e.target.value.trim())}
          placeholder="Premium emoji ID"
          className="h-8 text-sm font-mono flex-1 min-w-0"
        />
        {emojiId && (
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => setEmojiId('')} title="Clear">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || saving} onClick={save} className="h-8 gap-1.5">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save
      </Button>
    </div>
  );
}

// ---- Section card ----
function SectionCard({
  section, initialValue, buttons, onMessageSaved, onButtonsChanged,
}: {
  section: Section;
  initialValue: string;
  buttons: ButtonRow[];
  onMessageSaved: (key: string, value: string) => void;
  onButtonsChanged: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValue(initialValue); }, [initialValue]);

  const dirty = value !== initialValue;

  const save = async () => {
    setSaving(true);
    const { data: existing } = await supabase.from('bot_settings').select('id').eq('key', section.key).maybeSingle();
    const q = existing
      ? supabase.from('bot_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', section.key)
      : supabase.from('bot_settings').insert({ key: section.key, value });
    const { error } = await q;
    setSaving(false);
    if (error) toast.error('Message save failed');
    else { toast.success(`${section.title.replace(/^\d+\.\s*/, '')} saved`); onMessageSaved(section.key, value); }
  };

  const reset = () => setValue(section.default);

  return (
    <AccordionItem value={section.key} className="border-b border-border/60">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2 text-left">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="font-medium">{section.title}</span>
          <code className="text-[10px] text-muted-foreground/70 font-mono">{section.key}</code>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2 space-y-4">
        {section.desc && (
          <p className="text-xs text-muted-foreground flex items-start gap-1.5"><Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />{section.desc}</p>
        )}

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Message</Label>
          <TelegramEditor value={value} onChange={setValue} rows={7} placeholder="Message..." />
          {section.placeholders && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Variables:</span> <span className="font-mono">{section.placeholders}</span>
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={reset} className="gap-1.5 text-muted-foreground">
              <RotateCcw className="h-3.5 w-3.5" /> Default
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Message
            </Button>
          </div>
        </div>

        {section.buttons && section.buttons.length > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed border-border/60 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Buttons on this screen</Label>
              <Badge variant="secondary" className="text-[10px]">{buttons.length} / {section.buttons.length}</Badge>
            </div>
            {buttons.length === 0 ? (
              <p className="text-xs text-muted-foreground">No matching buttons found in <code>bot_button_emojis</code>.</p>
            ) : (
              <div className="space-y-2">
                {buttons.map((b) => <ButtonEditor key={b.id} row={b} onChanged={onButtonsChanged} />)}
              </div>
            )}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

// ---- Main tab ----
export default function MessageTemplatesTab() {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [buttons, setButtons] = useState<Record<string, ButtonRow>>({});

  const load = async () => {
    const keys = SECTIONS.map((s) => s.key);
    const allButtonKeys = Array.from(new Set(SECTIONS.flatMap((s) => s.buttons || [])));
    const [{ data: settings }, { data: btns }] = await Promise.all([
      supabase.from('bot_settings').select('key,value').in('key', keys),
      supabase.from('bot_button_emojis').select('id,button_key,button_label,custom_emoji_id').in('button_key', allButtonKeys),
    ]);
    const msgMap: Record<string, string> = {};
    for (const s of SECTIONS) msgMap[s.key] = s.default;
    for (const r of settings || []) if (r.value) msgMap[r.key] = r.value as string;
    setMessages(msgMap);
    const btnMap: Record<string, ButtonRow> = {};
    for (const b of btns || []) btnMap[b.button_key] = b as ButtonRow;
    setButtons(btnMap);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Section[]>();
    for (const g of GROUPS) map.set(g, []);
    for (const s of SECTIONS) map.get(s.group)!.push(s);
    return map;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Message Templates
          </CardTitle>
          <CardDescription>
            Bot er sob screen er msg + buttons ekhan theke edit koro. Serial e user ja dekhe sevabe sajano. Save korlei bot e sathe sathe update hobe (60s cache)।
          </CardDescription>
        </CardHeader>
      </Card>

      {GROUPS.map((group) => (
        <Card key={group} className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">{group}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="multiple" className="w-full">
              {grouped.get(group)!.map((section) => (
                <SectionCard
                  key={section.key}
                  section={section}
                  initialValue={messages[section.key] ?? section.default}
                  buttons={(section.buttons || []).map((k) => buttons[k]).filter(Boolean)}
                  onMessageSaved={(k, v) => setMessages((prev) => ({ ...prev, [k]: v }))}
                  onButtonsChanged={() => void load()}
                />
              ))}
            </Accordion>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
