'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './chat.css';
import { useChatThread } from './useChatThread';

const NEAR_BOTTOM_PX = 80;

export default function ChatThread({ getToken, header = 'SHERZ', fetchImpl }) {
  const { messages, hasMore, initialLoaded, loadingOlder, sending, error, loadOlder, send, prependRef } =
    useChatThread({ getToken, fetchImpl });

  const scrollerRef = useRef(null);
  const sentinelRef = useRef(null);
  const stickRef = useRef(true);            // is the reader at the bottom?
  const lastLenRef = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [draft, setDraft] = useState('');

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stickRef.current = near;
    setShowJump(!near);
  }, []);

  // Runs after DOM updates, before paint: no flicker.
  useLayoutEffect(() => {
    const el = scrollerRef.current; if (!el) return;
    if (prependRef.current) {                 // older page was added on top: keep the same message under the thumb
      const { height, top } = prependRef.current;
      el.scrollTop = el.scrollHeight - height + top;
      prependRef.current = null;
    } else if (!lastLenRef.current && messages.length) {
      scrollToBottom();                       // first paint of the thread: start at the newest message
      stickRef.current = true;
    } else if (stickRef.current) {
      scrollToBottom();                       // new message / streaming token while the reader is at the bottom
    }
    lastLenRef.current = messages.length;
  }, [messages, prependRef, scrollToBottom]);

  // Lazy-load older messages when the top sentinel nears the viewport.
  useEffect(() => {
    const root = scrollerRef.current, target = sentinelRef.current;
    if (!root || !target || !hasMore || !initialLoaded) return;
    const io = new IntersectionObserver(
      (e) => { if (e[0].isIntersecting) loadOlder(root); },
      { root, rootMargin: '200px 0px 0px 0px' },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [hasMore, initialLoaded, loadOlder, messages.length]);

  // If the first page doesn't even fill the screen, there is nothing to scroll: fetch more.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && initialLoaded && hasMore && !loadingOlder && el.scrollHeight <= el.clientHeight) loadOlder(el);
  }, [initialLoaded, hasMore, loadingOlder, messages.length, loadOlder]);

  const submit = (e) => {
    e?.preventDefault();
    if (!draft.trim() || sending) return;
    stickRef.current = true;
    send(draft); setDraft('');
  };

  return (
    <div className="chat-app">
      <div className="chat-header">{header}</div>
      <div className="chat-body">
        <div className="chat-scroller" ref={scrollerRef} onScroll={onScroll} data-testid="scroller">
          <div className="chat-list">
            {hasMore && <div className="chat-sentinel" ref={sentinelRef} />}
            {initialLoaded && !hasMore && messages.length > 0 && <div className="chat-status">Suhbat boshlanishi</div>}
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-ai'}`}>{m.text || (m.streaming ? '…' : '')}</div>
            ))}
            {error && <div className="chat-status" role="alert">{error}</div>}
          </div>
        </div>
        {loadingOlder && <div className="chat-loading" role="status">Yuklanmoqda…</div>}
        {showJump && <button className="chat-jump" onClick={scrollToBottom}>↓ Eng so‘nggisi</button>}
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <textarea
          rows={1} value={draft} placeholder="Xabar yozing…" aria-label="Xabar"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
        />
        <button type="submit" disabled={sending || !draft.trim()}>Yuborish</button>
      </form>
    </div>
  );
}
