import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/auth-context";
import { 
  LayoutDashboard, 
  ChefHat, 
  Carrot, 
  ClipboardList, 
  CalendarDays, 
  PackageSearch, 
  TrendingUp, 
  Truck,
  Building2,
  Settings,
  LogOut,
} from "lucide-react";

const navItems = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Production Plans", href: "/plans", icon: CalendarDays },
  { name: "Recipes", href: "/recipes", icon: ChefHat },
  { name: "Sub-Recipes", href: "/sub-recipes", icon: ClipboardList },
  { name: "Ingredients", href: "/ingredients", icon: Carrot },
  { name: "Suppliers", href: "/suppliers", icon: Building2 },
  { name: "Stock Inventory", href: "/stock", icon: PackageSearch },
  { name: "Sales Data", href: "/sales", icon: TrendingUp },
  { name: "Dispatches", href: "/dispatches", icon: Truck },
];

const bottomNavItems = [
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { state, logout } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-card/50 backdrop-blur-md flex flex-col hidden md:flex relative z-10">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-display font-bold shadow-lg shadow-primary/20">
            P
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-foreground">ProPlanner</span>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative
                  ${isActive 
                    ? "text-primary font-semibold" 
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}
                `}
              >
                {isActive && (
                  <motion.div 
                    layoutId="activeNav" 
                    className="absolute inset-0 bg-primary/10 rounded-xl" 
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon className={`w-5 h-5 relative z-10 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                <span className="relative z-10">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 pb-2">
          {bottomNavItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative
                  ${isActive
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}
                `}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNavBottom"
                    className="absolute inset-0 bg-primary/10 rounded-xl"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon className={`w-5 h-5 relative z-10 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                <span className="relative z-10">{item.name}</span>
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
            <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold text-sm flex-shrink-0">
              {user?.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-semibold truncate">{user?.name ?? "—"}</span>
              <span className="text-xs text-muted-foreground capitalize">{user?.role ?? ""}</span>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors flex-shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-8 z-10">
          <h2 className="font-display font-semibold text-lg text-muted-foreground capitalize">
            {[...navItems, ...bottomNavItems].find(n => n.href === location)?.name || "Dashboard"}
          </h2>
        </header>
        
        <div className="flex-1 overflow-y-auto p-4 md:p-8 relative">
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="max-w-6xl mx-auto"
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
