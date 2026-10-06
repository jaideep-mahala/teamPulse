// Redis client and connection management
export {
  createRedisClient,
  createRedisSubscriber,
  getPublisher,
  getSubscriber,
  closeRedisConnections,
  checkRedisHealth,
} from "./client";

// Key naming conventions
export {
  boardEventsChannel,
  boardPresenceKey,
  connectionMetaKey,
  PRESENCE_TTL_SECONDS,
  HEARTBEAT_INTERVAL_SECONDS,
} from "./keys";

// Real-time event broadcasting
export {
  publishBoardEvent,
  subscribeToBoardEvents,
  subscribeToMultipleBoardEvents,
  type BoardEvent,
} from "./realtime";

// Presence tracking
export { joinBoardPresence, type ConnectionMeta } from "./presence";
export {
  heartbeatBoardPresence,
  leaveBoardPresence,
  getBoardPresence,
  getConnectionsMeta,
  getBoardPresenceCount,
  cleanupStalePresence,
} from "./presence-extra";