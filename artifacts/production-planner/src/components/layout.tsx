import React, { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
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
  BarChart2,
  Settings,
  LogOut,
  MapPin,
  Tag,
  Menu,
  X,
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
  { name: "Reports", href: "/reports", icon: BarChart2 },
];

const bottomNavItems = [
  { name: "Settings", href: "/settings", icon: Settings },
];

function NavLinks({
  visibleNavItems,
  location,
  user,
  onNavigate,
}: {
  visibleNavItems: typeof navItems;
  location: string;
  user: { name?: string; role?: string } | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {visibleNavItems.map((item) => {
          const isActive = location === item.href;
          const isDispatches = item.href === "/dispatches";
          return (
            <React.Fragment key={item.name}>
              <Link
                href={item.href}
                onClick={onNavigate}
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
              {isDispatches && user?.role === "admin" && (
                <>
                  <Link
                    href="/locations"
                    onClick={onNavigate}
                    className={`
                      flex items-center gap-3 pl-9 pr-4 py-2 rounded-xl transition-all duration-200 group relative text-sm
                      ${location === "/locations"
                        ? "text-primary font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}
                    `}
                  >
                    {location === "/locations" && (
                      <motion.div
                        layoutId="activeNav"
                        className="absolute inset-0 bg-primary/10 rounded-xl"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                    <MapPin className={`w-4 h-4 relative z-10 ${location === "/locations" ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                    <span className="relative z-10">Bin Locations</span>
                  </Link>
                  <Link
                    href="/dispatch-tag"
                    onClick={onNavigate}
                    className={`
                      flex items-center gap-3 pl-9 pr-4 py-2 rounded-xl transition-all duration-200 group relative text-sm
                      ${location === "/dispatch-tag"
                        ? "text-primary font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}
                    `}
                  >
                    {location === "/dispatch-tag" && (
                      <motion.div
                        layoutId="activeNav"
                        className="absolute inset-0 bg-primary/10 rounded-xl"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                    <Tag className={`w-4 h-4 relative z-10 ${location === "/dispatch-tag" ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                    <span className="relative z-10">Dispatch Tagging</span>
                  </Link>
                </>
              )}
            </React.Fragment>
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
              onClick={onNavigate}
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
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { state, logout } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const { canAccess } = usePagePermissions();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleNavItems = navItems.filter(item =>
    canAccess(user?.role ?? "viewer", item.href)
  );

  const currentPageName = location === "/locations"
    ? "Bin Locations"
    : ([...navItems, ...bottomNavItems].find(n => n.href === location)?.name || "Dashboard");

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">

      {/* ── Desktop sidebar (md+) ───────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-card/50 backdrop-blur-md flex-col hidden md:flex relative z-10">
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20 p-1.5">
            <img
              src={`${import.meta.env.BASE_URL}tck-logo-short-cream.png`}
              alt="TCK"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-display font-bold text-sm leading-tight tracking-tight text-foreground truncate">The Calzone Kitchen</span>
            <span className="text-xs text-muted-foreground">Production Planner</span>
          </div>
        </div>

        <NavLinks visibleNavItems={visibleNavItems} location={location} user={user} />

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

      {/* ── Mobile drawer overlay ───────────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setMobileOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border flex flex-col md:hidden"
            >
              {/* Drawer header */}
              <div className="px-5 py-4 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary flex items-center justify-center p-1.5">
                    <img
                      src={`${import.meta.env.BASE_URL}tck-logo-short-cream.png`}
                      alt="TCK"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-display font-bold text-sm leading-tight">The Calzone Kitchen</span>
                    <span className="text-xs text-muted-foreground">Production Planner</span>
                  </div>
                </div>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <NavLinks
                visibleNavItems={visibleNavItems}
                location={location}
                user={user}
                onNavigate={() => setMobileOpen(false)}
              />

              {/* User footer */}
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
                    onClick={() => { logout(); setMobileOpen(false); }}
                    title="Sign out"
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors flex-shrink-0"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-4 md:px-8 gap-3 z-10">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h2 className="font-display font-semibold text-lg text-muted-foreground capitalize">
            {currentPageName}
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
