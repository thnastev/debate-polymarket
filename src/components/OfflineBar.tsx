import { useEffect, useState } from 'react';
import { subscribeQueue, flushQueue, type QueuedTrade } from '../lib/tradeQueue';

/** Corridors have bad signal. Say so, and say what is still owed to the server. */
export default function OfflineBar() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedTrade[]>([]);

  useEffect(() => {
    const up = () => { setOnline(true); void flushQueue(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  useEffect(() => subscribeQueue(setQueue), []);

  if (online && queue.length === 0) return null;
  return (
    <div className="offline">
      {!online && 'Offline. '}
      {queue.length > 0
        ? `${queue.length} bet${queue.length > 1 ? 's' : ''} waiting to send — they will go through as one each.`
        : 'Your bets will send when you are back.'}
    </div>
  );
}
