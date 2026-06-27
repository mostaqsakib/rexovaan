// Polyfill global WebSocket BEFORE @supabase/supabase-js loads.
// Must be imported as the very first module so the assignment runs
// before realtime-js's WebSocketFactory runs its Node version check.
import WebSocket from 'ws';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;
