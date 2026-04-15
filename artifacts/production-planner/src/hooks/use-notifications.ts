import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AppNotification {
  id: number;
  userId: number;
  type: string;
  message: string;
  andonIssueId: number | null;
  read: boolean;
  createdAt: string;
}

export function useNotifications() {
  const queryClient = useQueryClient();

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/notifications/unread-count`, { credentials: "include" });
      if (!res.ok) return 0;
      const data = await res.json();
      return data.count as number;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: notifications = [], refetch: fetchNotifications } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/notifications`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json() as Promise<AppNotification[]>;
    },
    enabled: false,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/notifications/${id}/read`, { method: "PATCH", credentials: "include" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/notifications/read-all`, { method: "PATCH", credentials: "include" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  return { unreadCount, notifications, fetchNotifications, markRead, markAllRead };
}
