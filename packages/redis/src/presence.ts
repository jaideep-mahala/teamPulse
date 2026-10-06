import { getPublisher } from "./client";
import { boardPresenceKey, connectionMetaKey, PRESENCE_TTL_SECONDS } from "./keys";

/**
 * Metadata stored for each connection.
 * Kept minimal - no PII, just what's needed for presence display.
 */
export interface ConnectionMeta {
  /** Anonymous connection ID (UUID) */
  connectionId: string;
  /** Board ID this connection is joined to */
  boardId: string;
  /** Optional profile photo URL for display */
  profilePhoto: string | null;
  /** Unix timestamp when this entry was last updated */
  lastHeartbeat: number;
}

/**
 * Adds a connection to a board's presence set.
 * Uses a Redis transaction to atomically add to set and set metadata.
 */
export async function joinBoardPresence(
  boardId: string,
  connectionId: string,
  profilePhoto: string | null
): Promise<number> {
  const client = getPublisher();
  const presenceKey = boardPresenceKey(boardId);
  const metaKey = connectionMetaKey(connectionId);
  const now = Date.now();

  const multi = client.multi();
  multi.sadd(presenceKey, connectionId);
  multi.expire(presenceKey, PRESENCE_TTL_SECONDS);
  multi.hset(metaKey, {
    connectionId,
    boardId,
    profilePhoto: profilePhoto ?? "",
    lastHeartbeat: now.toString(),
  });
  multi.expire(metaKey, PRESENCE_TTL_SECONDS);

  await multi.exec();
  const count = await client.scard(presenceKey);
  return count;
}