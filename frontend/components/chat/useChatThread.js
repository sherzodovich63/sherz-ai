'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';
const PAGE = 25;

/**
 * One endless thread: newest PAGE messages on load, older pages on demand (cursor),
 * dedupe by id. `getToken` is read on every request so a guest->Google token swap
 * is picked up without remounting.
 */
export function useChatThread({ getToken, fetchImpl }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const cursorRef = useRef(null);
  const busyRef = useRef(false);
  // set just before older messages are prepended so the view can keep its position
  const prependRef = useRef(null);

  const headers = useCallback(() => {
    const t = getToken?.();
    return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
  }, [getToken]);

  const loadPage = useCallback(async (before) => {
    const qs = new URLSearchParams({ limit: String(PAGE), ...(before ? { before } : {}) });
    const res = await doFetch(`${API}/api/chat/history?${qs}`, { headers: headers() });
    if (!res.ok) throw new Error(`history ${res.status}`);
    return res.json();
  }, [headers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await loadPage(null);
        if (!alive) return;
        setMessages(d.messages);
        setHasMore(!!d.hasMore);
        cursorRef.current = d.nextCursor || null;
      } catch (e) { if (alive) setError(e.message); }
      finally { if (alive) setInitialLoaded(true); }
    })();
    return () => { alive = false; };
  }, [loadPage]);

  const loadOlder = useCallback(async (scroller) => {
    if (busyRef.current || !cursorRef.current) return;
    busyRef.current = true; setLoadingOlder(true);
    try {
      const d = await loadPage(cursorRef.current);
      prependRef.current = scroller
        ? { height: scroller.scrollHeight, top: scroller.scrollTop }
        : null;
      cursorRef.current = d.nextCursor || null;
      setHasMore(!!d.hasMore);
      setMessages((cur) => {
        const have = new Set(cur.map((m) => m.id));
        return [...d.messages.filter((m) => !have.has(m.id)), ...cur];
      });
    } catch (e) { setError(e.message); }
    finally { busyRef.current = false; setLoadingOlder(false); }
  }, [loadPage]);

  const send = useCallback(async (text) => {
    const clean = String(text || '').trim();
    if (!clean || sending) return;
    const stamp = Date.now();
    const aiId = `tmp-ai-${stamp}`;
    setSending(true); setError(null);
    setMessages((cur) => [...cur,
      { id: `tmp-u-${stamp}`, role: 'user', text: clean, ts: stamp },
      { id: aiId, role: 'ai', text: '', ts: stamp, streaming: true }]);
    const patch = (fn) => setMessages((cur) => cur.map((m) => (m.id === aiId ? fn(m) : m)));
    try {
      const res = await doFetch(`${API}/api/chat-stream`, { method: 'POST', headers: headers(), body: JSON.stringify({ message: clean }) });
      if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {           // SSE frame: "event: x\ndata: {...}"
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(frame)?.[1];
          const raw = /^data: (.*)$/m.exec(frame)?.[1];
          let data = {}; try { data = JSON.parse(raw || '{}'); } catch { /* ignore bad frame */ }
          if (ev === 'chunk') patch((m) => ({ ...m, text: m.text + (data.delta || '') }));
          else if (ev === 'done') patch((m) => ({ ...m, text: data.text ?? m.text, streaming: false }));
          else if (ev === 'error') throw new Error(data.error || 'stream error');
        }
      }
      patch((m) => ({ ...m, streaming: false }));
    } catch (e) {
      setError(e.message);
      patch((m) => ({ ...m, streaming: false, text: m.text || '…', failed: true }));
    } finally { setSending(false); }
  }, [headers, sending]); // eslint-disable-line react-hooks/exhaustive-deps

  return { messages, hasMore, initialLoaded, loadingOlder, sending, error, loadOlder, send, prependRef };
}
