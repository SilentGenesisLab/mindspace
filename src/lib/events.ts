import { q } from './db';

export type SpaceEvent = { type: string; data: unknown; at: string };
type Subscriber = (event: SpaceEvent) => void;

const globalForBus = globalThis as unknown as { __msSubs?: Map<string, Set<Subscriber>> };
const subscribers: Map<string, Set<Subscriber>> = (globalForBus.__msSubs ??= new Map());

export function subscribe(spaceId: string, fn: Subscriber): () => void {
  let set = subscribers.get(spaceId);
  if (!set) {
    set = new Set();
    subscribers.set(spaceId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(spaceId);
  };
}

/** 广播给在线浏览器，并落一条空间事件（收集者的反馈链路会读它）。 */
export function publish(spaceId: string, type: string, data: unknown): void {
  const event: SpaceEvent = { type, data, at: new Date().toISOString() };
  const set = subscribers.get(spaceId);
  if (set) {
    for (const fn of set) {
      try {
        fn(event);
      } catch {
        /* one bad client must not break the rest */
      }
    }
  }
  q('insert into space_events (space_id, type, payload) values ($1, $2, $3)', [spaceId, type, JSON.stringify(data)]).catch(
    () => {},
  );
}
