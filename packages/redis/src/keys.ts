/**
 * Consistent Redis key naming conventions.
 * All keys are prefixed with "teampulse:" for namespace isolation.
 */

const PREFIX = "teampulse";

/** Channel for broadcasting board events across WebSocket server instances */
export const boardEventsChannel = (boardId: string): string =>
  `${PREFIX}:board:${boardId}:events`;

/** Key for tracking active connections in a board (Redis Set with TTL) */
export const boardPresenceKey = (boardId: string): string =>
  `${PREFIX}:board:${boardId}:presence`;

/** Key for storing connection metadata (hash) */
export const connectionMetaKey = (connectionId: string): string =>
  `${PREFIX}:connection:${connectionId}:meta`;

/** TTL for presence entries (seconds) - should be longer than heartbeat interval */
export const PRESENCE_TTL_SECONDS = 60;

/** Heartbeat interval (seconds) - clients should send heartbeat at this interval */
export const HEARTBEAT_INTERVAL_SECONDS = 15;