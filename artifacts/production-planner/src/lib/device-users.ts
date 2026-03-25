const STORAGE_KEY = "tck_device_user_ids";

export function getDeviceUserIds(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => typeof v === "number" && v > 0);
  } catch {
    return [];
  }
}

export function addDeviceUserId(id: number): void {
  const ids = getDeviceUserIds();
  if (!ids.includes(id)) {
    ids.push(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }
}

export function removeDeviceUserId(id: number): void {
  const ids = getDeviceUserIds().filter(i => i !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}
