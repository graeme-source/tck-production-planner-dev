import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Tag this device as desktop or mobile so the backend can clamp the session
// cookie lifetime for shared PCs without affecting iPads. Touch capability is
// the most reliable signal — iPads (incl. iPadOS spoofing Mac UA) report
// maxTouchPoints > 1; desktops report 0. Runs before React so the first
// request to /api/auth/me already carries the cookie.
(() => {
  const isTouch = typeof navigator !== "undefined"
    && (navigator.maxTouchPoints >= 1 || "ontouchstart" in window);
  const deviceType = isTouch ? "mobile" : "desktop";
  document.cookie = `tck_device=${deviceType}; path=/; max-age=31536000; samesite=lax`;
})();

createRoot(document.getElementById("root")!).render(<App />);
