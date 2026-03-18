import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Ingredients from "@/pages/ingredients";
import SubRecipes from "@/pages/sub-recipes";
import Recipes from "@/pages/recipes";
import ProductionPlans from "@/pages/production-plans";
import Stock from "@/pages/stock";
import Sales from "@/pages/sales";
import Dispatches from "@/pages/dispatches";
import Suppliers from "@/pages/suppliers";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/ingredients" component={Ingredients} />
        <Route path="/sub-recipes" component={SubRecipes} />
        <Route path="/recipes" component={Recipes} />
        <Route path="/plans" component={ProductionPlans} />
        <Route path="/stock" component={Stock} />
        <Route path="/sales" component={Sales} />
        <Route path="/dispatches" component={Dispatches} />
        <Route path="/suppliers" component={Suppliers} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
