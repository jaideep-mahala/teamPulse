import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import jwt from "jsonwebtoken";
import { prisma } from "../../packages/db";

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

interface Issue {
  id: string;
  title: string;
  section: string;
}

class WsManager {
  private static instance: WsManager;

  private wss: WebSocketServer;

  // Presence is tracked per SOCKET CONNECTION, not per user — this is what
  // makes "active users" anonymous and per-tab: two tabs from the same
  // person show up as two entries, and the id sent to other clients is a
  // random connection id, never the real user id.
  private boards: Record<
    string,
    {
      connectionId: string;
      profile: string | null;
      socket: WebSocket;
    }[]
  > = {};

  // Keeps track of which board each socket joined
  private joinedRooms = new Map<WebSocket, string>();

  // Anonymous per-connection id, assigned once when the socket connects
  private connectionIds = new Map<WebSocket, string>();

  private constructor() {
    this.wss = new WebSocketServer({
      port: WS_PORT,
    });

    this.initialize();
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
        });

        if (!board) {
          socket.close();
          return;
        }

        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }

        const previousBoardId = this.joinedRooms.get(socket);
        if (previousBoardId === boardId) {
          return;
        }

        if (previousBoardId && this.boards[previousBoardId]) {
          this.boards[previousBoardId] = this.boards[previousBoardId].filter(
            (member) => member.socket !== socket,
          );

          // Every connection is unique, so switching boards always means
          // this one tab left the previous board.
          this.boards[previousBoardId].forEach((member) => {
            member.socket.send(
              JSON.stringify({ type: "leave", id: connectionId }),
            );
          });

          if (this.boards[previousBoardId].length === 0) {
            delete this.boards[previousBoardId];
          } else {
            this.broadcastPresence(previousBoardId);
          }
        }

        this.joinedRooms.set(socket, boardId);

        if (!this.boards[boardId]) {
          this.boards[boardId] = [];
        }

        const boardMembers = this.boards[boardId];

        // This connection is always new to the room, so always announce it.
        boardMembers.forEach((member) => {
          member.socket.send(
            JSON.stringify({
              type: "join",
              id: connectionId,
              profile: profilePhoto,
            }),
          );
        });

        boardMembers.push({
          connectionId,
          profile: profilePhoto,
          socket,
        });

        socket.send(
          JSON.stringify({
            type: "initial_state",
            users: boardMembers.map((member) => member.connectionId),
          }),
        );
        this.broadcastPresence(boardId);
      } else if (parsedData.type === "issue_moved") {
        const boardId = this.joinedRooms.get(socket);
        if (!boardId) {
          return;
        }

        if (!this.boards[boardId]) {
          return;
        }

        this.boards[boardId]
          .filter((member) => member.socket !== socket)
          .forEach((member) => {
            member.socket.send(
              JSON.stringify({
                type: "issue_moved",
                issueId: parsedData.issueId,
                sectionId: parsedData.sectionId,
              }),
            );
          });
      } else if (parsedData.type === "board_changed") {
        const boardId = this.joinedRooms.get(socket);
        if (!boardId) {
          return;
        }

        if (!this.boards[boardId]) {
          return;
        }

        this.boards[boardId]
          .filter((member) => member.socket !== socket)
          .forEach((member) => {
            member.socket.send(JSON.stringify({ type: "board_changed" }));
          });
      }
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

  private broadcastPresence(boardId: string) {
    const members = this.boards[boardId] ?? [];
    const users = members.map((member) => member.connectionId);
    const message = JSON.stringify({
      type: "presence",
      count: users.length,
      users,
    });

    members.forEach(({ socket }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    });
  }

  private handleDisconnect(socket: WebSocket) {
    const joinedRoom = this.joinedRooms.get(socket);
    const connectionId = this.connectionIds.get(socket);
    this.connectionIds.delete(socket);

    if (!joinedRoom) {
      return;
    }

    const members = this.boards[joinedRoom];
    this.joinedRooms.delete(socket);
    if (!members) {
      return;
    }

    this.boards[joinedRoom] = members.filter((member) => member.socket !== socket);

    if (connectionId) {
      this.boards[joinedRoom].forEach((member) => {
        member.socket.send(JSON.stringify({ type: "leave", id: connectionId }));
      });
    }

    if (this.boards[joinedRoom].length === 0) {
      delete this.boards[joinedRoom];
    } else {
      this.broadcastPresence(joinedRoom);
    }
  }
}

WsManager.getInstance();