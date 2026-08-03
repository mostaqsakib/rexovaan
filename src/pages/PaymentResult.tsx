import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, XCircle, AlertTriangle, ArrowRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = "success" | "cancel" | "failed";

const CONFIG: Record<Status, { title: string; tone: string; ring: string; Icon: typeof CheckCircle2 }> = {
  success: { title: "Payment Successful", tone: "text-success", ring: "border-success/40 bg-success/10", Icon: CheckCircle2 },
  cancel: { title: "Payment Cancelled", tone: "text-yellow-500", ring: "border-yellow-500/40 bg-yellow-500/10", Icon: AlertTriangle },
  failed: { title: "Payment Failed", tone: "text-destructive", ring: "border-destructive/40 bg-destructive/10", Icon: XCircle },
};

export default function PaymentResult() {
  const [params] = useSearchParams();
  const status = (params.get("status") as Status) || "failed";
  const cfg = CONFIG[status] ?? CONFIG.failed;
  const message = params.get("msg") || "";
  const amount = params.get("amount");
  const trx = params.get("trx");
  const bot = params.get("bot");
  const source = params.get("source");

  const target = useMemo(() => {
    if (source === "bot" && bot) return `https://t.me/${bot}`;
    return null;
  }, [source, bot]);

  const [count, setCount] = useState(5);

  useEffect(() => {
    document.title = `${cfg.title} · Rexovaan Shoppie`;
    try {
      const tg = (window as unknown as { Telegram?: { WebApp?: { ready: () => void; expand: () => void; close: () => void } } }).Telegram?.WebApp;
      tg?.ready();
      tg?.expand();
    } catch { /* ignore */ }
  }, [cfg.title]);

  useEffect(() => {
    if (!target) return;
    const iv = setInterval(() => {
      setCount((n) => {
        if (n <= 1) {
          clearInterval(iv);
          window.location.href = target;
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [target]);

  const { Icon } = cfg;

  return (
    <main className="min-h-screen grid place-items-center bg-background px-5 py-12">
      <section className="w-full max-w-md rounded-3xl border border-border/60 bg-card/80 backdrop-blur-xl p-8 text-center shadow-2xl">
        <div className={`mx-auto mb-5 grid h-24 w-24 place-items-center rounded-full border-2 ${cfg.ring} animate-scale-in`}>
          <Icon className={`h-12 w-12 ${cfg.tone}`} strokeWidth={1.8} aria-hidden />
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Rexovaan Shoppie</p>
        <h1 className={`mt-2 text-2xl font-extrabold tracking-tight ${cfg.tone}`}>{cfg.title}</h1>
        {message && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>}

        {(amount || trx) && (
          <dl className="mt-6 space-y-2 rounded-2xl border border-border/60 bg-muted/30 p-4 text-left text-[13px]">
            {amount && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Credited</dt>
                <dd className="font-bold text-foreground">${amount} USDT</dd>
              </div>
            )}
            {trx && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">TrxID</dt>
                <dd className="truncate rounded-md bg-foreground/5 px-2 py-1 font-mono text-[11.5px] text-foreground">{trx}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-7 space-y-3">
          {target ? (
            <>
              <Button asChild className="w-full" size="lg">
                <a href={target}>
                  <Send className="mr-2 h-4 w-4" /> Open Rexovaan Bot
                </a>
              </Button>
              <p className="text-[11.5px] text-muted-foreground">
                Auto-redirecting in <span className={`font-bold ${cfg.tone}`}>{count}</span>s…
              </p>
            </>
          ) : (
            <Button asChild className="w-full" size="lg">
              <Link to="/account/deposit">
                Return to site <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
