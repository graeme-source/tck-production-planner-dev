import React from "react";
import { AlertTriangle, RotateCw, Home } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

export class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorCount: prev.errorCount + 1,
    }));
    this.props.onReset?.();
  };

  handleGoHome = () => {
    window.location.href = import.meta.env.BASE_URL || "/";
  };

  render() {
    if (this.state.hasError) {
      const tooManyRetries = this.state.errorCount >= 3;

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">
                {this.props.fallbackTitle || "Something went wrong"}
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {tooManyRetries
                  ? "This issue keeps happening. Try going back to the home page or refreshing the browser."
                  : "An unexpected error occurred. You can try again or go back to the home page."}
              </p>
            </div>

            {this.state.error?.message && (
              <div className="bg-muted/50 rounded-lg p-3 text-left">
                <p className="text-xs text-muted-foreground font-mono break-words">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <RotateCw className="w-4 h-4" />
                Reload
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex items-center gap-2 px-5 py-2.5 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-secondary transition-colors"
              >
                <Home className="w-4 h-4" />
                Home page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
