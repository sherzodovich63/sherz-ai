'use client';
import { useEffect, useState } from 'react';
import ChatThread from '../../components/chat/ChatThread';
import { getToken, startGuest } from '../../lib/guestSession';

export default function ChatPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => { startGuest().finally(() => setReady(true)); }, []);   // TODO: skip when a signed-in token already exists
  return ready ? <ChatThread getToken={getToken} /> : null;
}
