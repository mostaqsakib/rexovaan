import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type Currency = 'USD' | 'BDT';

interface CurrencyContextValue {
  currency: Currency;
  rate: number; // 1 USD = X BDT
  setCurrency: (c: Currency) => void;
  format: (usd: number | string, opts?: { decimals?: number }) => string;
  convert: (usd: number | string) => number;
  symbol: string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    if (typeof window === 'undefined') return 'USD';
    return (localStorage.getItem('preferred_currency') as Currency) || 'USD';
  });
  const [rate, setRate] = useState<number>(125);

  useEffect(() => {
    supabase.from('bot_settings').select('value').eq('key', 'dollar_rate_bdt').maybeSingle()
      .then(({ data }) => {
        const n = Number(data?.value);
        if (n && n > 0) setRate(n);
      });
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    try { localStorage.setItem('preferred_currency', c); } catch {}
  }, []);

  const convert = useCallback((usd: number | string) => {
    const n = Number(usd) || 0;
    return currency === 'BDT' ? n * rate : n;
  }, [currency, rate]);

  const format = useCallback((usd: number | string, opts?: { decimals?: number }) => {
    const n = Number(usd) || 0;
    const value = currency === 'BDT' ? n * rate : n;
    let decimals: number;
    if (opts?.decimals != null) {
      decimals = opts.decimals;
    } else {
      // Default decimals: BDT 0, USD 2. Extend up to 4 so small/fractional
      // values (e.g. $0.035 or ৳4.375) don't get rounded away.
      const base = currency === 'BDT' ? 0 : 2;
      const factor = (d: number) => Math.pow(10, d);
      const roundedBase = Math.round(value * factor(base)) / factor(base);
      if (value !== 0 && Math.abs(value - roundedBase) > 1e-9) {
        const rounded2 = Math.round(value * 100) / 100;
        const rounded3 = Math.round(value * 1000) / 1000;
        if (Math.abs(value - rounded2) <= 1e-9) decimals = Math.max(base, 2);
        else if (Math.abs(value - rounded3) <= 1e-9) decimals = Math.max(base, 3);
        else decimals = Math.max(base, 4);
      } else {
        decimals = base;
      }
    }
    const formatted = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return currency === 'BDT' ? `৳${formatted}` : `$${formatted}`;
  }, [currency, rate]);

  return (
    <CurrencyContext.Provider value={{ currency, rate, setCurrency, format, convert, symbol: currency === 'BDT' ? '৳' : '$' }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
