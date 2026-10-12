import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatThread from '../../components/chat/ChatThread.jsx';

const N = 300;
const all = Array.from({ length: N }, (_, i) => ({
  id: 'm' + String(i).padStart(4, '0'), role: i % 2 ? 'ai' : 'user', ts: 1e12 + i,
  text: i === 150 ? 'x'.repeat(400) : i % 7 === 0 ? `msg ${i} ` + 'lorem ipsum dolor sit amet '.repeat(12) : `msg ${i}`,
}));
window.__calls = [];
const mockFetch = async (url, opts = {}) => {
  const u = new URL(url, 'http://x');
  if (u.pathname === '/api/chat/history') {
    const limit = +u.searchParams.get('limit'); const before = u.searchParams.get('before');
    const end = before ? all.findIndex((m) => m.id === before.split('_')[1]) : N;
    const start = Math.max(0, end - limit);
    window.__calls.push({ before, n: end - start });
    await new Promise((r) => setTimeout(r, 30));
    const page = all.slice(start, end);
    return new Response(JSON.stringify({ ok: true, messages: page, hasMore: start > 0, nextCursor: start > 0 ? `1_${page[0].id}` : null }));
  }
  if (u.pathname === '/api/chat-stream') {
    const enc = new TextEncoder();
    const stream = new ReadableStream({ async start(c) {
      const words = 'Bu SHERZ javobi oqim bilan keladi va uzun bo‘lishi mumkin '.repeat(25).split(' ');
      for (const w of words) { c.enqueue(enc.encode(`event: chunk\ndata: ${JSON.stringify({ delta: w + ' ' })}\n\n`)); await new Promise((r) => setTimeout(r, 2)); }
      c.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify({ text: words.join(' ') + ' ' })}\n\n`)); c.close();
    } });
    return new Response(stream);
  }
  return new Response('{}', { status: 404 });
};
createRoot(document.getElementById('root')).render(<ChatThread getToken={() => 'tok'} fetchImpl={mockFetch} />);
