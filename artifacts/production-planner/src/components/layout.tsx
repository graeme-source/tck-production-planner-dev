import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { 
  LayoutDashboard, 
  ChefHat, 
  Carrot, 
  ClipboardList, 
  CalendarDays, 
  PackageSearch, 
  TrendingUp, 
  Truck
} from "lucide-react";

const navItems = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Production Plans", href: "/plans", icon: CalendarDays },
  { name: "Recipes", href: "/recipes", icon: ChefHat },
  { name: "Sub-Recipes", href: "/sub-recipes", icon: ClipboardList },
  { name: "Ingredients", href: "/ingredients", icon: Carrot },
  { name: "Stock Inventory", href: "/stock", icon: PackageSearch },
  { name: "Sales Data", href: "/sales", icon: TrendingUp },
  { name: "Dispatches", href: "/dispatches", icon: Truck },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

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

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
            <img 
              src={`https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=100&h=100&fit=crop`} 
              alt="User" 
              className="w-10 h-10 rounded-full border-2 border-background shadow-sm"
            />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Chef Alex</span>
              <span className="text-xs text-muted-foreground">Kitchen Manager</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-8 z-10">
          <h2 className="font-display font-semibold text-lg text-muted-foreground capitalize">
            {navItems.find(n => n.href === location)?.name || "Dashboard"}
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
