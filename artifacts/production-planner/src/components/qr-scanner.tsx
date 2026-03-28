import { useEffect, useRef, useState, useId, Component, type ReactNode } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, XCircle, RotateCcw } from "lucide-react";

class QrErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {}
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

interface QrScannerProps {
  onScan: (data: string) => void;
  onError?: (error: string) => void;
  active?: boolean;
}

function QrScannerInner({ onScan, onError, active = true }: QrScannerProps) {
  const reactId = useId();
  const elementId = useRef(`qr-reader-${reactId.replace(/:/g, "")}`).current;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [status, setStatus] = useState<"initializing" | "scanning" | "error">("initializing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasScannedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!active) return;

    hasScannedRef.current = false;
    setStatus("initializing");
    setErrorMessage(null);

    let localScanner: Html5Qrcode | null = null;

    const timeout = setTimeout(async () => {
      const el = document.getElementById(elementId);
      if (!el || !mountedRef.current) return;

      try {
        const scanner = new Html5Qrcode(elementId);
        localScanner = scanner;
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1,
          },
          (decodedText) => {
            if (!hasScannedRef.current && mountedRef.current) {
              hasScannedRef.current = true;
              onScan(decodedText);
            }
          },
          () => {}
        );

        if (mountedRef.current) {
          setStatus("scanning");
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          const msg = err instanceof Error ? err.message : String(err || "Camera access denied");
          setStatus("error");
          setErrorMessage(msg);
          onError?.(msg);
        }
      }
    }, 100);

    return () => {
      clearTimeout(timeout);
      const scanner = localScanner || scannerRef.current;
      if (scanner) {
        try {
          scanner.stop().catch(() => {});
        } catch {}
        try {
          scanner.clear();
        } catch {}
        if (scannerRef.current === scanner) {
          scannerRef.current = null;
        }
      }
    };
  }, [active, elementId]);

  const handleRetry = async () => {
    setStatus("initializing");
    setErrorMessage(null);
    hasScannedRef.current = false;

    if (scannerRef.current) {
      try { scannerRef.current.stop().catch(() => {}); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }

    const el = document.getElementById(elementId);
    if (!el) return;

    try {
      const scanner = new Html5Qrcode(elementId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          if (!hasScannedRef.current) {
            hasScannedRef.current = true;
            onScan(decodedText);
          }
        },
        () => {}
      );
      setStatus("scanning");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || "Camera access denied");
      setStatus("error");
      setErrorMessage(msg);
      onError?.(msg);
    }
  };

  if (!active) return null;

  return (
    <div className="flex flex-col items-center gap-3">
      {status === "initializing" && (
        <div className="flex flex-col items-center gap-2 py-8">
          <Camera className="w-8 h-8 text-muted-foreground animate-pulse" />
          <p className="text-sm text-muted-foreground">Starting camera...</p>
        </div>
      )}

      <div
        id={elementId}
        className={`w-full max-w-[300px] rounded-xl overflow-hidden ${status === "error" ? "hidden" : ""}`}
      />

      {status === "scanning" && (
        <p className="text-xs text-muted-foreground text-center">
          Point your camera at a QR code
        </p>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <XCircle className="w-10 h-10 text-destructive/60" />
          <div className="text-center">
            <p className="text-sm font-medium text-destructive">Camera Error</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
              {errorMessage || "Could not access camera. Please allow camera permissions and try again."}
            </p>
          </div>
          <button
            onClick={handleRetry}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export function QrScanner(props: QrScannerProps) {
  return (
    <QrErrorBoundary
      fallback={
        <div className="flex flex-col items-center gap-3 py-6">
          <XCircle className="w-10 h-10 text-destructive/60" />
          <div className="text-center">
            <p className="text-sm font-medium text-destructive">Camera Error</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
              Camera is not available. Please use a device with a camera.
            </p>
          </div>
        </div>
      }
    >
      <QrScannerInner {...props} />
    </QrErrorBoundary>
  );
}
