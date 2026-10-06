import type Redis from "ioredis";
import { getPublisher, getSubscriber } from "./client";
import { boardEventsChannel } from "./keys";

/**
 * Event types that can be broadcast across WebSocket instances.
 * Keep payloads minimal - receivers fetch full data from API if needed.
 */
export type BoardEvent =
  | { type: "issue_moved"; issueId: string; sectionId: string; boardId: string }
  | { type: "issue_created"; issueId: string; sectionId: string; boardId: string }
  | { type: "issue_deleted"; issueId: string; boardId: string }
  | { type: "issue_updated"; issueId: string; boardId: string }
  | { type: "section_created"; sectionId: string; boardId: string }
  | { type: "section_updated"; sectionId: string; boardId: string }
  | { type: "section_deleted"; sectionId: string; boardId: string }
  | { type: "board_changed"; boardId: string }
  | { type: "board_deleted"; boardId: string }
  | { type: "presence_changed"; boardId: string };

/**
 * Publishes a board event to all WebSocket server instances.
 * The event is delivered via Redis Pub/Sub to the board's channel.
 *
 * NEVER throws: a Redis outage must not break an API response or a
 * WebSocket handler. Failures are logged and the event is dropped.
 */
export async function publishBoardEvent(event: BoardEvent): Promise<void> {
  try {
    const publisher = getPublisher();
    const channel = boardEventsChannel(event.boardId);
    await publisher.publish(channel, JSON.stringify(event));
  } catch (err) {
    console.error("[Redis] Failed to publish board event:", err);
  }
}

// channel -> active handlers. One shared "message" listener per subscriber
// client routes events by channel, so handlers only ever see their own
// board's messages (a single subscriber connection carries ALL channels).
const channelHandlers = new Map<string, Set<(event: BoardEvent) => void>>();
let wiredSubscriber: Redis | null = null;

function ensureWired(subscriber: Redis): void {
  if (wiredSubscriber === subscriber) return;
  wiredSubscriber = subscriber;

  subscriber.on("message", (channel: string, message: string) => {
    const handlers = channelHandlers.get(channel);
    if (!handlers || handlers.size === 0) return;
    try {
      const event = JSON.parse(message) as BoardEvent;
      handlers.forEach((handler) => handler(event));
    } catch (err) {
      console.error("[Redis] Failed to parse board event:", err);
    }
  });

  // Re-subscribe every known channel after a reconnect. This covers the
  // case where the initial SUBSCRIBE failed while Redis was down.
  subscriber.on("ready", () => {
    for (const channel of channelHandlers.keys()) {
      subscriber.subscribe(channel).catch((err: unknown) => {
        console.error(`[Redis] Re-subscribe to ${channel} failed:`, err);
      });
    }
  });
}

/**
 * Subscribes to board events for a specific board.
 * Returns an unsubscribe function.
 */
export function subscribeToBoardEvents(
  boardId: string,
  handler: (event: BoardEvent) => void
): () => void {
  const subscriber = getSubscriber();
  const channel = boardEventsChannel(boardId);

  let handlers = channelHandlers.get(channel);
  if (!handlers) {
    handlers = new Set();
    channelHandlers.set(channel, handlers);
    ensureWired(subscriber);
    subscriber.subscribe(channel).catch((err: unknown) => {
      // The "ready" handler retries once the connection is established.
      console.error(`[Redis] Subscribe to ${channel} failed:`, err);
    });
  }
  handlers.add(handler);

  // Return cleanup function
  return () => {
    const current = channelHandlers.get(channel);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      channelHandlers.delete(channel);
      subscriber.unsubscribe(channel).catch((err: unknown) => {
        console.error(`[Redis] Unsubscribe from ${channel} failed:`, err);
      });
    }
  };
}

/**
 * Subscribes to board events for multiple boards.
 * Returns an unsubscribe function that cleans up all subscriptions.
 */
export function subscribeToMultipleBoardEvents(
  boardIds: string[],
  handler: (event: BoardEvent) => void
): () => void {
  const unsubscribers = boardIds.map((boardId) =>
    subscribeToBoardEvents(boardId, handler)
  );

  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}