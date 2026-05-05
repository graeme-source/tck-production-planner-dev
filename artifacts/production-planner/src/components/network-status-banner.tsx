import { WifiOff, RefreshCw } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

export function NetworkStatusBanner() {
  const { status, retry } = useNetworkStatus();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try { await retry(); } finally { setRetrying(false); }
  };

  return (
    <AnimatePresence>
      {status === "offline" && (
        <motion.div
          key="offline-banner"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="bg-amber-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-3 flex-wrap">
            <span className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 flex-shrink-0" />
              Connection lost. The page will reconnect automatically — changes may not save until it does.
            </span>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={"w-3.5 h-3.5" + (retrying ? " animate-spin" : "")} />
              {retrying ? "Checking…" : "Retry now"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
