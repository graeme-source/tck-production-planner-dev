import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { AnimatePresence, motion } from "framer-motion";

export function NetworkStatusBanner() {
  const status = useNetworkStatus();

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
          <div className="bg-amber-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            <span>You are offline. Changes may not be saved until the connection is restored.</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
