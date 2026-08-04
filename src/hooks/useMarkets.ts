import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMarkets } from '../services/exchanges';
import type { Exchange, MarketCoin } from '../types';

export function useMarkets(exchange: Exchange) {
  const [data, setData] = useState<MarketCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true);
    setError('');
    try {
      const result = await fetchMarkets(exchange, controller.current.signal);
      setData(result.data); setLive(result.live); setUpdatedAt(new Date()); setWarning(result.warning ?? '');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setData([]); setLive(false); setUpdatedAt(undefined); setWarning('');
        setError(`Can't connect to ${exchange === 'binance' ? 'Binance' : 'Bitget'} API. ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally { setLoading(false); }
  }, [exchange]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { window.clearInterval(timer); controller.current?.abort(); };
  }, [refresh]);

  return { data, loading, live, updatedAt, error, warning, refresh };
}
