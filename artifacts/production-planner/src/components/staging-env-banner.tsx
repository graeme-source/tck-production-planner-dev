import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Shown at the very top of the app when the backend reports
 * appEnv === "staging". Purely visual — it's a big red stripe so nobody
 * can mistake staging for production during a smoke-test. Mirrors the
 * server-side shouldSkipSideEffect() check so any Shopify write, email
 * send, or real fulfilment will no-op in this environment.
 *
 * Hits GET /api/env (unauthenticated) on mount. No-op on production.
 */
export function StagingEnvBanner() {
  const [appEnv, setAppEnv] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/env", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.appEnv) setAppEnv(d.appEnv); })
      .catch(() => { /* ignore — banner just won't render */ });
    return () => { cancelled = true; };
  }, []);

  if (appEnv !== "staging") return null;

  return (
    <div className="bg-red-600 text-white px-4 py-2 text-center text-sm font-bold flex items-center justify-center gap-2 border-b-2 border-red-800">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span>
        STAGING ENVIRONMENT — not the live kitchen app. Shopify writes, emails and fulfilments are disabled.
      </span>
    </div>
  );
}
