import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import jwt from "jsonwebtoken";
import { prisma } from "../../packages/db";
import { closeRedisConnections } from "redis";
import {
  publishBoardEvent,
  subscribeToBoardEvents,
  type BoardEvent,
} from "redis";
import {
  joinBoardPresence,
  leaveBoardPresence,
  heartbeatBoardPresence,
  getBoardPresence,
  cleanupStalePresence,
  HEARTBEAT_INTERVAL_SECONDS,
  PRESENCE_TTL_SECONDS,
} from "redis";

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
})();

type Payload = {
  id: string;
  email: string;
};

const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 5000;

type LocalMember = {
  connectionId: string;
  profile: string | null;
  socket: WebSocket;
};

class WsManager {
  private static instance: WsManager;

  private wss: WebSocketServer;

  // Presence is tracked per SOCKET CONNECTION, not per user — this is what
  // makes "active users" anonymous and per-tab: two tabs from the same
  // person show up as two entries, and the id sent to other clients is a
  // random connection id, never the real user id.
  //
  // localBoards only holds sockets connected to THIS process; the
  // authoritative cross-instance presence lives in Redis.
  private localBoards: Record<string, LocalMember[]> = {};

  // Keeps track of which board each local socket joined
  private joinedRooms = new Map<WebSocket, string>();

  // Anonymous per-connection id, assigned once when the socket connects
  private connectionIds = new Map<WebSocket, string>();

  // One Redis unsubscribe function per board this process is listening to
  private boardSubscriptions = new Map<string, () => void>();

  private presenceRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.wss = new WebSocketServer({
      port: WS_PORT,
    });

    this.initialize();
    this.startPeriodicJobs();
  }

  public static getInstance(): WsManager {
    if (!WsManager.instance) {
      WsManager.instance = new WsManager();
    }
    return WsManager.instance;
  }

  private initialize() {
    this.wss.on("connection", (socket, req) => {
      const query = req.url?.split("?")[1] ?? "";
      const token = new URLSearchParams(query).get("token");

      if (!token) {
        socket.close();
        return;
      }

      let payload: Payload;
      try {
        payload = jwt.verify(token, JWT_SECRET) as Payload;
      } catch {
        socket.close();
        return;
      }

      // One anonymous id per connection — this is what gets broadcast to
      // other clients, never payload.id.
      this.connectionIds.set(socket, crypto.randomUUID());

      socket.on("message", async (data) => {
        await this.handleMessage(data, payload, socket);
      });

      socket.on("close", () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private subscribeToBoard(boardId: string) {
    if (this.boardSubscriptions.has(boardId)) return;
    const unsub = subscribeToBoardEvents(boardId, (event: BoardEvent) => {
      this.handleRedisEvent(event);
    });
    this.boardSubscriptions.set(boardId, unsub);
  }

  private unsubscribeFromBoard(boardId: string) {
    const unsub = this.boardSubscriptions.get(boardId);
    if (!unsub) return;
    unsub();
    this.boardSubscriptions.delete(boardId);
  }

  // Fans a Redis event out to the local sockets of the event's board.
  private handleRedisEvent(event: BoardEvent) {
    if (event.type === "presence_changed") {
      // Another instance (or this one) gained/lost a connection — refresh
      // the global presence list for everyone watching this board locally.
      void this.broadcastPresence(event.boardId);
      return;
    }

    const localMembers = this.localBoards[event.boardId] ?? [];
    if (localMembers.length === 0) return;

    const message = JSON.stringify(event);
    localMembers.forEach(({ socket }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    });
  }

  private async handleMessage(
    data: RawData,
    payload: Payload,
    socket: WebSocket,
  ) {
    try {
      let parsedData;
      try {
        parsedData = JSON.parse(data.toString());
      } catch {
        return;
      }

      const connectionId = this.connectionIds.get(socket);
      if (!connectionId) {
        socket.close();
        return;
      }

      const user = await prisma.user.findUnique({
        where: {
          id: payload.id,
        },
      });

      if (!user) {
        socket.close();
        return;
      }

      const profilePhoto = user.profilePhoto;

      if (parsedData.type === "join") {
        const boardId = parsedData.boardId;
        const board = await prisma.boards.findFirst({
          where: {
            id: boardId,
            organization: {
              membership: {
                some: {
                  userId: payload.id,
                },
              },
            },
          },
          select: { id: true },
        });

        if (!board) {
          socket.close();
          return;
        }

        // Leave the previous board first when switching boards.
        const previousBoardId = this.joinedRooms.get(socket);
        if (previousBoardId && previousBoardId !== boardId) {
          await this.leaveBoard(socket, previousBoardId, connectionId);
        }

        await this.joinBoard(socket, boardId, connectionId, profilePhoto);
      } else if (parsedData.type === "heartbeat") {
        const boardId = this.joinedRooms.get(socket);
        if (boardId) {
          await heartbeatBoardPresence(boardId, connectionId);
        }
      }
      // NOTE: board mutations (issue/section changes) are published to Redis
      // by the backend API after the database write, so clients do NOT send
      // mutation events over the socket.
    } catch (error) {
      // Presence updates depend on this succeeding (the user lookup and the
      // board-membership check below both hit the database), so make the
      // failure explicit instead of dropping the message silently.
      console.error(
        "Failed to handle message — presence/active-user updates will not work:",
        error,
      );
    }
  }

  private async joinBoard(
    socket: WebSocket,
    boardId: string,
    connectionId: string,
    profile: string | null,
  ) {
    // Add to Redis presence (cross-instance, authoritative). Falls back to
    // local-only presence when Redis is unavailable.
    try {
      await joinBoardPresence(boardId, connectionId, profile);
    } catch (error) {
      console.error("[Redis] joinBoardPresence failed:", error);
    }

    // Listen for board events from other instances.
    this.subscribeToBoard(boardId);

    this.joinedRooms.set(socket, boardId);
    if (!this.localBoards[boardId]) {
      this.localBoards[boardId] = [];
    }

    const boardMembers = this.localBoards[boardId];

    // This connection is always new to the room, so always announce it.
    boardMembers.forEach((member) => {
      member.socket.send(
        JSON.stringify({
          type: "join",
          id: connectionId,
          profile,
        }),
      );
    });

    boardMembers.push({ connectionId, profile, socket });

    // Initial state carries the GLOBAL connection id list (all instances).
    // The frontend expects plain string ids here.
    const allConnectionIds = await this.globalPresence(boardId);
    socket.send(
      JSON.stringify({
        type: "initial_state",
        users: allConnectionIds,
      }),
    );

    // Tell everyone (including other instances) that presence changed.
    await publishBoardEvent({ type: "presence_changed", boardId });
    await this.broadcastPresence(boardId);
  }

  private async leaveBoard(
    socket: WebSocket,
    boardId: string,
    connectionId: string,
  ) {
    try {
      await leaveBoardPresence(boardId, connectionId);
    } catch (error) {
      console.error("[Redis] leaveBoardPresence failed:", error);
    }

    this.joinedRooms.delete(socket);

    const members = this.localBoards[boardId];
    if (members) {
      members.forEach((member) => {
        member.socket.send(JSON.stringify({ type: "leave", id: connectionId }));
      });

      this.localBoards[boardId] = members.filter(
        (member) => member.socket !== socket,
      );

      if (this.localBoards[boardId].length === 0) {
        delete this.localBoards[boardId];
        this.unsubscribeFromBoard(boardId);
      }
    }

    await publishBoardEvent({ type: "presence_changed", boardId });
    await this.broadcastPresence(boardId);
  }

  private handleDisconnect(socket: WebSocket) {
    const joinedRoom = this.joinedRooms.get(socket);
    const connectionId = this.connectionIds.get(socket);
    this.connectionIds.delete(socket);

    if (!joinedRoom || !connectionId) {
      this.joinedRooms.delete(socket);
      return;
    }

    this.leaveBoard(socket, joinedRoom, connectionId).catch((error) => {
      console.error("Failed to leave board on disconnect:", error);
    });
  }

  // Redis is the source of truth for presence; fall back to the local list
  // when Redis is unavailable so the board still works without it.
  private async globalPresence(boardId: string): Promise<string[]> {
    try {
      return await getBoardPresence(boardId);
    } catch (error) {
      console.error("[Redis] getBoardPresence failed:", error);
      return (this.localBoards[boardId] ?? []).map((m) => m.connectionId);
    }
  }

  // Sends the global connection id list + count to every local socket.
  private async broadcastPresence(boardId: string): Promise<void> {
    const localMembers = this.localBoards[boardId] ?? [];
    if (localMembers.length === 0) return;

    const users = await this.globalPresence(boardId);
    const message = JSON.stringify({
      type: "presence",
      count: users.length,
      users,
    });

    localMembers.forEach(({ socket }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    });
  }

  private startPeriodicJobs() {
    // The frontend never sends heartbeats, so refresh the TTL of every local
    // connection from the server side. Without this, active connections would
    // silently drop out of the Redis presence set after PRESENCE_TTL_SECONDS.
    this.presenceRefreshInterval = setInterval(() => {
      const refresh = async () => {
        for (const [boardId, members] of Object.entries(this.localBoards)) {
          for (const { connectionId, profile } of members) {
            try {
              const alive = await heartbeatBoardPresence(boardId, connectionId);
              if (!alive) {
                // Entry expired (e.g. Redis restart) — re-register it.
                await joinBoardPresence(boardId, connectionId, profile);
              }
            } catch (error) {
              console.error("[Redis] presence refresh failed:", error);
              return; // Redis is down — skip the rest of this round.
            }
          }
        }
      };
      void refresh();
    }, Math.max(HEARTBEAT_INTERVAL_SECONDS, 5) * 1000);

    // Periodically remove entries whose meta TTL lapsed (e.g. after a crash).
    this.cleanupInterval = setInterval(() => {
      cleanupStalePresence().catch((error) => {
        console.error("[Redis] cleanupStalePresence failed:", error);
      });
    }, PRESENCE_TTL_SECONDS * 1000);
  }

  public async shutdown() {
    if (this.presenceRefreshInterval) {
      clearInterval(this.presenceRefreshInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const unsub of this.boardSubscriptions.values()) {
      unsub();
    }
    this.boardSubscriptions.clear();
    await closeRedisConnections();
    this.wss.close();
  }
}

// Initialize the WebSocket server
WsManager.getInstance();

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await WsManager.getInstance().shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down...");
  await WsManager.getInstance().shutdown();
  process.exit(0);
});

console.log(`WebSocket server running on port ${WS_PORT}`);
