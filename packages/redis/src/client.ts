import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Bounded backoff that NEVER gives up (never returns null) so connections
 * recover on their own once Redis comes back. Capped at 5s between attempts.
 */
const retryStrategy = (times: number): number => Math.min(times * 200, 5000);

/**
 * Ensures a lazily-created client actually starts connecting.
 * Safe to call multiple times.
 */
function ensureConnected(client: Redis): void {
  if (client.status === "wait") {
    client.connect().catch((err: unknown) => {
      console.error("[Redis] Connection attempt failed:", err);
    });
  }
}

/**
 * Creates a Redis client for regular commands (publish, presence ops).
 * Commands fail FAST when Redis is unavailable (maxRetriesPerRequest: 1)
 * so API responses are never blocked, while the connection keeps retrying
 * in the background for automatic recovery.
 * Caller is responsible for calling .quit() on shutdown.
 */
export function createRedisClient(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy,
    lazyConnect: true,
  });

  client.on("error", (err) => {
    console.error("[Redis] Client error:", err.message);
  });

  client.on("connect", () => {
    console.log("[Redis] Connected");
  });

  client.on("close", () => {
    console.log("[Redis] Connection closed");
  });

  return client;
}

/**
 * Creates a Redis client specifically for Pub/Sub subscriptions.
 * Pub/Sub connections should not be used for regular commands.
 * maxRetriesPerRequest is null so SUBSCRIBE waits indefinitely for the
 * connection instead of being rejected during a reconnect.
 */
export function createRedisSubscriber(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    connectTimeout: 2000,
    retryStrategy,
    lazyConnect: true,
  });

  client.on("error", (err) => {
    console.error("[Redis] Subscriber error:", err.message);
  });

  return client;
}

let _publisher: Redis | null = null;
let _subscriber: Redis | null = null;

/**
 * Gets or creates the shared publisher client.
 * Use this for publishing events and regular Redis commands.
 */
export function getPublisher(): Redis {
  if (!_publisher) {
    _publisher = createRedisClient();
  }
  ensureConnected(_publisher);
  return _publisher;
}

/**
 * Gets or creates the shared subscriber client.
 * Use this ONLY for Pub/Sub subscriptions.
 */
export function getSubscriber(): Redis {
  if (!_subscriber) {
    _subscriber = createRedisSubscriber();
  }
  ensureConnected(_subscriber);
  return _subscriber;
}

/**
 * Gracefully closes all Redis connections.
 * Call this on application shutdown.
 */
export async function closeRedisConnections(): Promise<void> {
  const clients: (Redis | null)[] = [_publisher, _subscriber];
  _publisher = null;
  _subscriber = null;

  await Promise.all(
    clients.map(async (client) => {
      if (!client) return;
      if (client.status === "ready") {
        try {
          await client.quit();
          return;
        } catch {
          // fall through to disconnect
        }
      }
      client.disconnect();
    }),
  );
  console.log("[Redis] All connections closed");
}

/**
 * Checks if Redis is healthy (can ping).
 * Fails fast when Redis is unavailable.
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getPublisher();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}
