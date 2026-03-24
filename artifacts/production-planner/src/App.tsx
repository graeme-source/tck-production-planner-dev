import React from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Ingredients from "@/pages/ingredients";
import SubRecipes from "@/pages/sub-recipes";
import Recipes from "@/pages/recipes";
import ProductionPlans from "@/pages/production-plans";
import StationPage from "@/pages/station";
import Stock from "@/pages/stock";
import Sales from "@/pages/sales";
import Dispatches from "@/pages/dispatches";
import Suppliers from "@/pages/suppliers";
import Supplies from "@/pages/supplies";
import Settings from "@/pages/settings";
import LeanCave from "@/pages/lean-cave";
import Reports from "@/pages/reports";
import Fulfilment from "@/pages/fulfilment";
import Locations from "@/pages/locations";
import Kanbans from "@/pages/kanbans";
import Orders from "@/pages/orders";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import AcceptInvite from "@/pages/accept-invite";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

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

      {/* All other pages with sidebar layout */}
      <Route>
        {() => (
          <Layout>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/ingredients" component={Ingredients} />
              <Route path="/sub-recipes" component={SubRecipes} />
              <Route path="/recipes" component={Recipes} />
              <Route path="/plans" component={ProductionPlans} />
              <Route path="/stock" component={Stock} />
              <Route path="/sales">{() => <ProtectedRoute component={Sales} pageKey="/sales" />}</Route>
              <Route path="/dispatches" component={Dispatches} />
              <Route path="/suppliers" component={Suppliers} />
              <Route path="/supplies" component={Supplies} />
              <Route path="/orders" component={Orders} />
              <Route path="/fulfilment">{() => <ProtectedRoute component={Fulfilment} pageKey="/fulfilment" />}</Route>
              <Route path="/locations">{() => <ProtectedRoute component={Locations} pageKey="/locations" />}</Route>
              <Route path="/kanbans">{() => <ProtectedRoute component={Kanbans} pageKey="/kanbans" />}</Route>
              <Route path="/reports">{() => <ProtectedRoute component={Reports} pageKey="/reports" />}</Route>
              <Route path="/lean-cave" component={LeanCave} />
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
  const { state } = useAuth();
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

  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthGate />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
