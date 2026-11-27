import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe, type QueueEntry } from "@/lib/fulfil-queue";

/** The packing screen's fulfil queue (lib/fulfil-queue.ts), live. */
export function useFulfilQueue(): QueueEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
