import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import type { Response } from 'express';
import { broadcastSupabaseEvent } from './supabase.ts';

export interface WsClient {
  ws: WebSocket;
  role: 'audience' | 'controller';
  isAlive: boolean;
}

export interface SseClient {
  res: Response;
  role: 'audience' | 'controller';
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WsClient> = new Set();
  private sseClients: Set<SseClient> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  public initialize(server: Server) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      try {
        const host = request.headers.host || 'localhost:3000';
        const rawPath = request.url ? new URL(request.url, `http://${host}`).pathname : '';
        const pathname = rawPath.replace(/\/+$/, '') || '/';
        
        if (pathname === '/ws' || pathname === '/ws/audience' || pathname === '/ws/controller') {
          this.wss?.handleUpgrade(request, socket, head, (ws) => {
            const role = pathname === '/ws/controller' ? 'controller' : 'audience';
            this.wss?.emit('connection', ws, request, role);
          });
        }
      } catch (err) {
        // Upgrade parse error fallback
      }
    });

    this.wss.on('connection', (ws: WebSocket, _request: any, role: 'audience' | 'controller' = 'audience') => {
      const client: WsClient = { ws, role, isAlive: true };
      this.clients.add(client);

      ws.on('pong', () => {
        client.isAlive = true;
      });

      ws.on('close', () => {
        this.clients.delete(client);
      });

      ws.on('error', () => {
        this.clients.delete(client);
      });

      // Respond to client-level application pings (heartbeats)
      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data && data.type === 'PING') {
            client.isAlive = true;
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
            }
          }
        } catch {
          // Non-JSON or unsupported message ignored
        }
      });
    });

    // Ping every 15s to keep both WS and SSE connections alive across reverse proxies
    this.heartbeatInterval = setInterval(() => {
      // WS ping
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          return;
        }
        client.isAlive = false;
        client.ws.ping();
      });

      // SSE keepalive comment
      this.sseClients.forEach((client) => {
        try {
          client.res.write(': keepalive\n\n');
        } catch {
          this.sseClients.delete(client);
        }
      });
    }, 15000);
  }

  public registerSseClient(res: Response, role: 'audience' | 'controller') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const client: SseClient = { res, role };
    this.sseClients.add(client);

    // Initial connection acknowledgement
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', payload: { role }, timestamp: new Date().toISOString() })}\n\n`);

    res.on('close', () => {
      this.sseClients.delete(client);
    });
  }

  public broadcastAudience(type: string, payload: any) {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const packet = { id, type, payload, timestamp: new Date().toISOString() };
    const message = JSON.stringify(packet);
    
    // 1. WebSocket broadcast
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });

    // 2. Server-Sent Events (SSE) broadcast
    this.sseClients.forEach((client) => {
      try {
        client.res.write(`data: ${message}\n\n`);
      } catch {
        this.sseClients.delete(client);
      }
    });

    // 3. Supabase Realtime WebSocket broadcast
    broadcastSupabaseEvent(type, packet).catch(() => {});
  }

  public broadcastController(type: string, payload: any) {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const packet = { id, type, payload, timestamp: new Date().toISOString() };
    const message = JSON.stringify(packet);
    
    // 1. WebSocket broadcast
    this.clients.forEach((client) => {
      if (client.role === 'controller' && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });

    // 2. SSE broadcast
    this.sseClients.forEach((client) => {
      if (client.role === 'controller') {
        try {
          client.res.write(`data: ${message}\n\n`);
        } catch {
          this.sseClients.delete(client);
        }
      }
    });

    // 3. Supabase Realtime WebSocket broadcast
    broadcastSupabaseEvent(type, packet).catch(() => {});
  }

  public broadcastAll(type: string, payload: any) {
    this.broadcastAudience(type, payload);
    this.broadcastController(type, payload);
  }

  public getStats() {
    let wsAudience = 0;
    let wsController = 0;
    this.clients.forEach((c) => {
      if (c.role === 'controller') wsController++;
      else wsAudience++;
    });

    let sseAudience = 0;
    let sseController = 0;
    this.sseClients.forEach((c) => {
      if (c.role === 'controller') sseController++;
      else sseAudience++;
    });

    return {
      total: this.clients.size + this.sseClients.size,
      ws: { total: this.clients.size, audience: wsAudience, controller: wsController },
      sse: { total: this.sseClients.size, audience: sseAudience, controller: sseController },
      audience: wsAudience + sseAudience,
      controller: wsController + sseController,
    };
  }

  public close() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss?.close();
    this.sseClients.forEach((c) => {
      try {
        c.res.end();
      } catch {}
    });
    this.sseClients.clear();
  }
}

export const wsManager = new WebSocketManager();

