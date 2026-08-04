import { sseAddClient, sseRemoveClient } from '../realtime/sseHub.js';

export function streamRoute(app) {
  app.get('/api/stream', (req, res) => {
    const userId = String(req.query.userId || 'u1');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    console.log(JSON.stringify({ ts: Date.now(), userId, event: 'sse_connect' }));

    // ping (proxy/hosting uzilmasligi uchun)
    const ping = setInterval(() => {
      res.write(`event: ping\ndata: {}\n\n`);
    }, 15000);

    sseAddClient(userId, res);

    req.on('close', () => {
      clearInterval(ping);
      sseRemoveClient(userId, res);
      console.log(JSON.stringify({ ts: Date.now(), userId, event: 'sse_disconnect' }));
    });
  });
}