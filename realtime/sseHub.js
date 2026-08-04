// realtime/sseHub.js
// SSE connection hub — manages all active client connections

const clients = new Map(); // userId -> Set of res objects

/**
 * Register a new SSE client connection.
 */
export function sseRegister(userId, res) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId).add(res);
}

/**
 * Remove an SSE client connection.
 */
export function sseUnregister(userId, res) {
  if (clients.has(userId)) {
    clients.get(userId).delete(res);
    if (clients.get(userId).size === 0) {
      clients.delete(userId);
    }
  }
}

/**
 * Broadcast an event to ALL connected clients (all users).
 * Used by proactiveRunner.js and any global broadcast needs.
 */
export function sseSend(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const connections of clients.values()) {
    for (const res of connections) {
      try {
        res.write(payload);
      } catch (err) {
        // Connection likely closed; ignore
      }
    }
  }
}

/**
 * Push an event to a specific user's SSE connections.
 */
export function ssePushToUser(userId, event, data) {
  if (!clients.has(userId)) return false;
  const payload = `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const res of clients.get(userId)) {
    try { 
      res.write(payload); 
      sent++; 
    } catch (err) {
      // Connection likely closed; ignore
    }
  }
  return sent > 0;
}

/**
 * Return an array of all userIds with at least one active SSE connection.
 * Used by idleEngine.js to determine who to nudge.
 */
export function getActiveUserIds() {
  return Array.from(clients.keys());
}

// --- ALIASES TO FIX CLAUDE'S RE-NAMING BUGS ---
// This ensures routes/stream.js can still import the old names without crashing
export { sseRegister as sseAddClient };
export { sseUnregister as sseRemoveClient };