import { useQuery } from "@tanstack/react-query";
import { ORDER_EMAIL_SETTING_KEY, parseOrderEmailTemplate } from "@/lib/order-email-template";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const ORDER_EMAIL_QUERY_KEY = ["app-setting", ORDER_EMAIL_SETTING_KEY] as const;

/** The saved order wording, or the default until someone has edited it. */
export function useOrderEmailTemplate() {
  return useQuery({
    queryKey: ORDER_EMAIL_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/app-settings/${ORDER_EMAIL_SETTING_KEY}`, { credentials: "include" });
      if (res.status === 404) return parseOrderEmailTemplate(null);
      if (!res.ok) throw new Error("Couldn't load the order email template");
      const body = (await res.json()) as { value: string };
      return parseOrderEmailTemplate(body.value);
    },
    staleTime: 60_000,
  });
}
