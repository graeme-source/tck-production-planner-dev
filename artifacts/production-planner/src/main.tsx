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

// Dev-environment tint: the Vite dev server (localhost, or accessed from the
// iPad over the LAN) compiles import.meta.env.DEV to true; the Railway
// production build compiles it to false. So this green background can only ever
// appear on the Dev site, never on live — a glanceable "this is the test DB" cue.
if (import.meta.env.DEV) {
  document.documentElement.classList.add("dev-env");
}

createRoot(document.getElementById("root")!).render(<App />);
