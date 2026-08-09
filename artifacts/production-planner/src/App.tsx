import React from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { Layout } from "@/components/layout";
import { PinSetupModal } from "@/components/pin-setup-modal";
import { AppErrorBoundary } from "@/components/error-boundary";
import { NetworkStatusBanner } from "@/components/network-status-banner";
import { StagingEnvBanner } from "@/components/staging-env-banner";
import { PullToRefresh } from "@/components/pull-to-refresh";
import Dashboard from "@/pages/dashboard";
import MeetingPage from "@/pages/meeting";
import VisitorCheckIn from "@/pages/visitor-check-in";
import PackReport from "@/pages/pack-report";
import LabelLiveTest from "@/pages/label-live-test";
import Ingredients from "@/pages/ingredients";
import Inventory from "@/pages/inventory";
import ToolsPage from "@/pages/tools";
import LabelStockCheck from "@/pages/label-stock-check";
import SubRecipes from "@/pages/sub-recipes";
import Recipes from "@/pages/recipes";
import ProductionPlans from "@/pages/production-plans";
import QueuedProductionPage from "@/pages/queued-production";
import StationPage from "@/pages/station";
import Stock from "@/pages/stock";
import Sales from "@/pages/sales";
import Dispatches from "@/pages/dispatches";
import CaseOrders from "@/pages/case-orders";
import Suppliers from "@/pages/suppliers";
import Supplies from "@/pages/supplies";
import Settings from "@/pages/settings";
import LeanCave from "@/pages/lean-cave";
import Reports from "@/pages/reports";
import Improvements from "@/pages/improvements";
import EmployeeHub from "@/pages/employee-hub";
import Fulfilment from "@/pages/fulfilment";
import Locations from "@/pages/locations";
import Orders from "@/pages/orders";
import Deliveries from "@/pages/deliveries";
import FounderView from "@/pages/founder";
import FounderPnL from "@/pages/founder-pnl";
import FounderFocus from "@/pages/founder-focus";
import FounderSales from "@/pages/founder-sales";
import DocumentViewer from "@/pages/document-viewer";
import StockControl from "@/pages/stock-control";
import ProductHub from "@/pages/product-hub";
import Surveys from "@/pages/surveys";
import TrainingMatrix from "@/pages/training-matrix";
import Onboarding from "@/pages/onboarding";
import NotFound from "@/pages/not-found";
import FireActionNoticePrint from "@/pages/print/fire-action-notice";
import FireSafetyEquipmentAuditPrint from "@/pages/print/fire-safety-equipment-audit";
import RecipePnLReport from "@/pages/print/recipe-pnl";
import SopStepsPrint from "@/pages/print/sop-steps";
import Login from "@/pages/login";
import AcceptInvite from "@/pages/accept-invite";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import { Loader2 } from "lucide-react";
import { PinLockOverlay } from "@/components/pin-lock-overlay";
import { PasswordResetGate } from "@/components/password-reset-gate";
import { toast } from "@/hooks/use-toast";

function isApiError(error: unknown): error is { status: number; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as Record<string, unknown>).status === "number"
  );
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (isApiError(error) && error.status === 401) return;
      console.error("[QueryCache] Query error:", error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isApiError(error) && error.status === 401) return;
      console.error("[MutationCache] Mutation error:", error);
    },
  }),
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: "always",
    },
    mutations: {
      retry: false,
    },
  },
});

const PUBLIC_PATHS = ["/accept-invite", "/forgot-password", "/reset-password"];

function ProtectedRoute({ component: Component, pageKey }: { component: React.ComponentType; pageKey: string }) {
  const { state } = useAuth();
  const { canAccess } = usePagePermissions();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  if (!canAccess(role, pageKey)) return <Redirect to="/" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      {/* Station pages — full-screen, no sidebar layout */}
      <Route path="/plans/:planId/station/:stationType" component={StationPage} />

      {/* Morning Meeting — full-screen slideshow */}
      <Route path="/meeting" component={MeetingPage} />

      {/* Visitor check-in — full-screen kiosk, no sidebar. The iPad gets
          handed to a visitor, so the app nav must not be reachable. */}
      <Route path="/visitor-check-in" component={VisitorCheckIn} />

      {/* Print / resource pages — full-screen, no sidebar, print-optimised */}
      <Route path="/print/fire-action-notice" component={FireActionNoticePrint} />
      <Route path="/print/fire-safety-equipment-audit" component={FireSafetyEquipmentAuditPrint} />
      <Route path="/print/recipe-pnl" component={RecipePnLReport} />
      <Route path="/print/sop/:id" component={SopStepsPrint} />

      {/* All other pages with sidebar layout */}
      <Route>
        {() => (
          <Layout>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/pack-report" component={PackReport} />
              <Route path="/label-live-test" component={LabelLiveTest} />
              <Route path="/inventory" component={Inventory} />
              <Route path="/inventory/tools" component={ToolsPage} />
              <Route path="/inventory/tools/label-stock-check" component={LabelStockCheck} />
              <Route path="/ingredients">{() => <Redirect to="/inventory?tab=ingredients" />}</Route>
              <Route path="/sub-recipes" component={SubRecipes} />
              <Route path="/recipes" component={Recipes} />
              <Route path="/plans" component={ProductionPlans} />
              <Route path="/plans/queued" component={QueuedProductionPage} />
              <Route path="/improvements" component={Improvements} />
              <Route path="/stock" component={Stock} />
              <Route path="/sales">{() => <ProtectedRoute component={Sales} pageKey="/sales" />}</Route>
              <Route path="/dispatches" component={Dispatches} />
              <Route path="/case-orders" component={CaseOrders} />
              <Route path="/suppliers" component={Suppliers} />
              <Route path="/supplies">{() => <Redirect to="/inventory?tab=supplies" />}</Route>
              <Route path="/orders" component={Orders} />
              <Route path="/fulfilment">{() => <ProtectedRoute component={Fulfilment} pageKey="/fulfilment" />}</Route>
              <Route path="/locations">{() => <ProtectedRoute component={Locations} pageKey="/locations" />}</Route>
              {/* Kanban board retired — kanban config lives on the ingredient
                  edit form, and scanning a card queues it for today's order
                  (orders page / quick-report scanner). */}
              <Route path="/kanbans">{() => <Redirect to="/orders" />}</Route>
              <Route path="/deliveries" component={Deliveries} />
              <Route path="/stock-control" component={StockControl} />
              <Route path="/product-hub" component={ProductHub} />
              <Route path="/surveys">{() => <ProtectedRoute component={Surveys} pageKey="/surveys" />}</Route>
              {/* Founder area — a site within a site. The schedule is home:
                  /founder always lands there, and FounderNav (shared tab
                  strip on every founder page) covers the side-trips. */}
              <Route path="/founder">{() => <Redirect to="/founder/focus" />}</Route>
              <Route path="/founder/numbers" component={FounderView} />
              <Route path="/founder/pnl" component={FounderPnL} />
              <Route path="/founder/focus" component={FounderFocus} />
              <Route path="/founder/sales" component={FounderSales} />
              <Route path="/reports">{() => <ProtectedRoute component={Reports} pageKey="/reports" />}</Route>
              <Route path="/training">{() => <ProtectedRoute component={TrainingMatrix} pageKey="/training" />}</Route>
              <Route path="/lean-cave" component={LeanCave} />
              <Route path="/hub" component={EmployeeHub} />
              <Route path="/documents/:id" component={DocumentViewer} />
              <Route path="/settings" component={Settings} />
              <Route component={NotFound} />
            </Switch>
          </Layout>
        )}
      </Route>
    </Switch>
  );
}

function AuthGate() {
  const { state, pinLocked, refreshUser } = useAuth();
  const [location] = useLocation();

  const isPublicPath = PUBLIC_PATHS.some(p => location.startsWith(p));

  if (isPublicPath) {
    return (
      <Switch>
        <Route path="/accept-invite" component={AcceptInvite} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
      </Switch>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return <Login />;
  }

  const user = state.user;
  // Order: set password (accept-invite) → set PIN → onboarding form → app.
  if (!user.hasPin) {
    return (
      <PinSetupModal
        user={user}
        required
        onClose={() => {}}
        onComplete={async () => {
          await refreshUser();
        }}
      />
    );
  }

  if (user.onboardingRequired && !user.onboardingCompletedAt) {
    return <Onboarding onComplete={async () => { await refreshUser(); }} />;
  }

  return (
    <>
      <PasswordResetGate />
      <Router />
      {pinLocked && <PinLockOverlay />}
    </>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <StagingEnvBanner />
            <NetworkStatusBanner />
            <PullToRefresh />
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthGate />
            </WouterRouter>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
