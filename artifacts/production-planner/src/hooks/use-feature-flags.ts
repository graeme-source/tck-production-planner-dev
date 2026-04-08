import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FeatureFlags {
  checklists: boolean;
}

const DEFAULTS: FeatureFlags = {
  checklists: false,
};

export function useFeatureFlags(): FeatureFlags & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "feature-flags"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/app-settings/`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json() as Promise<Record<string, string>>;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  return {
    checklists: data?.feature_checklists === "true",
    isLoading,
  };
}

export function useFeatureFlagsMutation() {
  const queryKey = ["app-settings", "feature-flags"];
  return { queryKey };
}
