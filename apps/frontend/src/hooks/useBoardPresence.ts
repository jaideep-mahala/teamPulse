import { useEffect, useState } from "react";

type PresenceMessage = {
  type?: unknown;
  users?: unknown;
  count?: unknown;
  id?: unknown;
};

export function useBoardPresence(boardId: string): number | null {
  // null means "unknown" — either there is no token, or the socket has not
  // reported a count yet. It is deliberately not seeded with 1: an optimistic
  // count hides a dead WebSocket and makes a backend failure look like a UI bug.
  const [activeUserCount, setActiveUserCount] = useState<number | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem("authToken");
    if (!token) {
      setActiveUserCount(null);
      return;
    }

    const activeUsers = new Set<string>();
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.hostname;
      socket = new WebSocket(
        `${protocol}//${host}:5000?token=${encodeURIComponent(token)}`,
      );
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: "join", boardId }));
      };
      socket.onmessage = (event) => {
        if (cancelled) return;
        try {
          const message = JSON.parse(String(event.data)) as PresenceMessage;
          if (
            (message.type === "presence" || message.type === "initial_state") &&
            Array.isArray(message.users)
          ) {
            activeUsers.clear();
            for (const id of message.users) {
              if (typeof id === "string") activeUsers.add(id);
            }
            setActiveUserCount(activeUsers.size);
          } else if (message.type === "presence" && typeof message.count === "number") {
            setActiveUserCount(message.count);
          } else if (message.type === "join" && typeof message.id === "string") {
            activeUsers.add(message.id);
            setActiveUserCount(activeUsers.size);
          } else if (message.type === "leave" && typeof message.id === "string") {
            activeUsers.delete(message.id);
            setActiveUserCount(activeUsers.size);
          }
        } catch {
          // Ignore malformed messages and keep the board usable.
        }
      };
      socket.onclose = () => {
        if (cancelled) return;
        // The count is no longer trustworthy while disconnected, so report
        // "unknown" rather than showing a stale number.
        setActiveUserCount(null);
        reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [boardId]);

  return activeUserCount;
}