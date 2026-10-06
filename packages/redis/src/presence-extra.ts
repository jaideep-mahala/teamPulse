import { getPublisher } from "./client";
import { boardPresenceKey, connectionMetaKey, PRESENCE_TTL_SECONDS } from "./keys";
import type { ConnectionMeta } from "./presence";

/**
 * Updates the heartbeat timestamp for a connection.
 * Also refreshes the TTL on both the presence set and metadata.
 */
export async function heartbeatBoardPresence(
  boardId: string,
  connectionId: string
): Promise<boolean> {
  const client = getPublisher();
  const presenceKey = boardPresenceKey(boardId);
  const metaKey = connectionMetaKey(connectionId);
  const now = Date.now();

  const isMember = await client.sismember(presenceKey, connectionId);
  if (!isMember) {
    return false;
  }

  const multi = client.multi();
  multi.hset(metaKey, "lastHeartbeat", now.toString());
  multi.expire(metaKey, PRESENCE_TTL_SECONDS);
  multi.expire(presenceKey, PRESENCE_TTL_SECONDS);
  await multi.exec();

  return true;
}

/**
 * Removes a connection from a board's presence set.
 * Returns the new count of active connections.
 */
export async function leaveBoardPresence(
  boardId: string,
  connectionId: string
): Promise<number> {
  const client = getPublisher();
  const presenceKey = boardPresenceKey(boardId);
  const metaKey = connectionMetaKey(connectionId);

  const multi = client.multi();
  multi.srem(presenceKey, connectionId);
  multi.del(metaKey);
  await multi.exec();

  const count = await client.scard(presenceKey);
  if (count === 0) {
    await client.del(presenceKey);
  }
  return count;
}

/**
 * Gets all active connection IDs for a board.
 */
export async function getBoardPresence(boardId: string): Promise<string[]> {
  const client = getPublisher();
  const presenceKey = boardPresenceKey(boardId);
  return client.smembers(presenceKey);
}

/**
 * Gets metadata for multiple connections.
 * Returns a map of connectionId -> ConnectionMeta.
 */
export async function getConnectionsMeta(
  connectionIds: string[]
): Promise<Map<string, ConnectionMeta>> {
  if (connectionIds.length === 0) {
    return new Map();
  }

  const client = getPublisher();
  const metaKeys = connectionIds.map(connectionMetaKey);

  const pipeline = client.pipeline();
  metaKeys.forEach((key) => pipeline.hgetall(key));

  const results = await pipeline.exec();
  const metaMap = new Map<string, ConnectionMeta>();

  connectionIds.forEach((connectionId, index) => {
    const result = results?.[index];
    if (result && result[1] && typeof result[1] === "object") {
      const data = result[1] as Record<string, string>;
      metaMap.set(connectionId, {
        connectionId: data.connectionId ?? connectionId,
        boardId: data.boardId ?? "",
        profilePhoto: data.profilePhoto ?? null,
        lastHeartbeat: parseInt(data.lastHeartbeat ?? "0", 10),
      });
    }
  });

  return metaMap;
}

/**
 * Gets the current active user count for a board.
 */
export async function getBoardPresenceCount(boardId: string): Promise<number> {
  const client = getPublisher();
  const presenceKey = boardPresenceKey(boardId);
  return client.scard(presenceKey);
}

/**
 * Cleans up stale presence entries (connections that haven't sent heartbeat).
 * Should be called periodically by a background job.
 * Returns number of cleaned up connections.
 */
export async function cleanupStalePresence(maxAgeMs: number = PRESENCE_TTL_SECONDS * 1000): Promise<number> {
  const client = getPublisher();
  const pattern = `${boardPresenceKey("*")}`;
  
  let cursor = "0";
  let cleanedCount = 0;
  const now = Date.now();

  do {
    const [nextCursor, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;

    for (const presenceKey of keys) {
      const connectionIds = await client.smembers(presenceKey);
      
      for (const connectionId of connectionIds) {
        const metaKey = connectionMetaKey(connectionId);
        const lastHeartbeatStr = await client.hget(metaKey, "lastHeartbeat");
        
        if (lastHeartbeatStr) {
          const lastHeartbeat = parseInt(lastHeartbeatStr, 10);
          if (now - lastHeartbeat > maxAgeMs) {
            await client.srem(presenceKey, connectionId);
            await client.del(metaKey);
            cleanedCount++;
          }
        } else {
          await client.srem(presenceKey, connectionId);
          await client.del(metaKey);
          cleanedCount++;
        }
      }

      const remainingCount = await client.scard(presenceKey);
      if (remainingCount === 0) {
        await client.del(presenceKey);
      }
    }
  } while (cursor !== "0");

  return cleanedCount;
}