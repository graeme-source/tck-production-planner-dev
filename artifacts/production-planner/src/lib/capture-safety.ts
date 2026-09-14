/**
 * Local safety net for camera captures (Graeme, 2026-09-14: an after-video
 * failed to upload and was gone — iOS hands the app a TEMP file that never
 * reaches the camera roll, so a failed upload was total loss).
 *
 * The capture is stashed in IndexedDB the moment it's picked, BEFORE the
 * upload starts, and only cleared once the server confirms. A failed upload
 * (or a closed app) leaves the stash behind, and the attachments UI offers
 * recover / retry / save-to-phone. Single slot: the latest capture wins —
 * the net exists for the one that just failed, not as a media library.
 */

const DB_NAME = "tck-capture-safety";
const STORE = "captures";
const SLOT = "latest";

/** A stash older than this is stale — the moment has passed and holding a
 *  100MB blob forever helps nobody. */
export const STASH_FRESH_MS = 48 * 60 * 60 * 1000;

export interface StashedCapture {
  blob: Blob;
  name: string;
  mime: string;
  /** Where it was headed — shown on the recovery card so "video from
   *  earlier (after)" makes sense, not used to restrict recovery. */
  improvementId: number;
  phase: string | null;
  at: number; // epoch ms
}

export function stashIsFresh(at: number, now: number): boolean {
  return now - at >= 0 && now - at <= STASH_FRESH_MS;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

/** Best-effort — storage being unavailable (private mode, quota) must never
 *  break the capture flow itself. */
export async function stashCapture(file: File, improvementId: number, phase: string | null): Promise<void> {
  try {
    const entry: StashedCapture = {
      blob: file,
      name: file.name || "capture",
      mime: file.type,
      improvementId,
      phase,
      at: Date.now(),
    };
    await tx("readwrite", s => s.put(entry, SLOT));
  } catch {
    // No stash — the upload path still works, there's just no net today.
  }
}

/** The stashed capture, if one exists and is fresh. Stale entries are
 *  cleaned up on read. */
export async function readStash(): Promise<StashedCapture | null> {
  try {
    const entry = await tx<StashedCapture | undefined>("readonly", s => s.get(SLOT));
    if (!entry) return null;
    if (!stashIsFresh(entry.at, Date.now())) {
      await clearStash();
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function clearStash(): Promise<void> {
  try {
    await tx("readwrite", s => s.delete(SLOT));
  } catch {
    // Best-effort.
  }
}

/**
 * Put a file somewhere the user owns. On iOS/Android the share sheet offers
 * "Save Video" / "Save Image" (which lands in the camera roll — the thing a
 * web page cannot do silently); elsewhere it falls back to a download.
 * Returns false only when the user cancelled the share sheet.
 */
export async function saveFileToDevice(file: File): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      // Share failed for another reason — fall through to download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name || "capture";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
