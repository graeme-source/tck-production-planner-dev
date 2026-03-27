import React, { ReactNode, useState, useEffect, useRef } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ReportButton } from "@/components/report-modal";
import { useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { usePageHeaderValue } from "@/contexts/page-header-context";
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
  Lightbulb,
  ShoppingBag,
  ChevronDown,
  Box,
  ArrowDownCircle,
  ShoppingCart,
  PackageCheck,
  KeyRound,
  User,
  LockKeyhole,
  Beaker,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";

export type NavItem = { name: string; href: string; icon: React.ComponentType<{ className?: string }> };

export const navItems: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Production Plans", href: "/plans", icon: CalendarDays },
  { name: "Dispatches", href: "/dispatches", icon: Truck },
  { name: "Suppliers", href: "/suppliers", icon: Building2 },
  { name: "Analytics", href: "/reports", icon: BarChart2 },
];

export const inventorySubItems: NavItem[] = [
  { name: "Ingredients", href: "/inventory?tab=ingredients", icon: Carrot },
  { name: "Supplies", href: "/inventory?tab=supplies", icon: Box },
  { name: "Stock Control", href: "/stock-control", icon: PackageSearch },
  { name: "Kanbans", href: "/kanbans", icon: ArrowDownCircle },
  { name: "Orders", href: "/orders", icon: ShoppingCart },
  { name: "Deliveries", href: "/deliveries", icon: PackageCheck },
];

const INVENTORY_PATHS = ["/inventory", "/kanbans", "/orders", "/deliveries", "/stock-control"];

export const productNavItems: NavItem[] = [
  { name: "Recipes", href: "/recipes", icon: ChefHat },
  { name: "Sub-Recipes", href: "/sub-recipes", icon: ClipboardList },
  { name: "Ingredients", href: "/inventory?tab=ingredients", icon: Carrot },
  { name: "Product Hub", href: "/product-hub", icon: Beaker },
];

export const bottomNavItems: NavItem[] = [
  { name: "Lean Cave", href: "/lean-cave", icon: Lightbulb },
  { name: "Settings", href: "/settings", icon: Settings },
];

const PRODUCT_PATHS = ["/recipes", "/sub-recipes", "/inventory", "/product-hub"];
const DISPATCH_PATHS = ["/dispatches", "/locations"];

type AccountButtonUser = { name?: string; role?: string; avatarUrl?: string | null } | null;

export function AccountButton({
  user,
  logout,
  lockStation,
  onNavigate,
}: {
  user: AccountButtonUser;
  logout: () => void;
  lockStation: () => void;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors"
      >
        <UserAvatar name={user?.name ?? "?"} avatarUrl={user?.avatarUrl} size="md" />
        <div className="flex flex-col min-w-0 flex-1 text-left">
          <span className="text-sm font-semibold truncate">{user?.name ?? "—"}</span>
          <span className="text-xs text-muted-foreground capitalize">{user?.role ?? ""}</span>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0", open ? "rotate-180" : "")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50"
          >
            <Link
              href="/settings?tab=profile"
              onClick={() => { setOpen(false); onNavigate?.(); }}
              className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-secondary/50 transition-colors"
            >
              <User className="w-4 h-4 text-muted-foreground" />
              Profile & Avatar
            </Link>
            <Link
              href="/settings?tab=pin"
              onClick={() => { setOpen(false); onNavigate?.(); }}
              className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-secondary/50 transition-colors"
            >
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              Change PIN
            </Link>
            <div className="border-t border-border" />
            <button
              onClick={() => { setOpen(false); lockStation(); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-secondary/50 transition-colors"
            >
              <LockKeyhole className="w-4 h-4 text-muted-foreground" />
              Lock station
            </button>
            <div className="border-t border-border" />
            <button
              onClick={() => { setOpen(false); logout(); onNavigate?.(); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function NavLinks({
  visibleNavItems,
  visibleProductItems,
  visibleInventoryItems,
  location,
  search,
  user,
  onNavigate,
}: {
  visibleNavItems: NavItem[];
  visibleProductItems: NavItem[];
  visibleInventoryItems: NavItem[];
  location: string;
  search: string;
  user: { name?: string; role?: string } | null;
  onNavigate?: () => void;
}) {
  const fullPath = location + (search ? search : "");
  const isOnProductPage = PRODUCT_PATHS.includes(location);
  const isOnDispatchPage = DISPATCH_PATHS.includes(location);
  const isOnInventoryPage = INVENTORY_PATHS.includes(location);
  const [productOpen, setProductOpen] = useState(isOnProductPage);
  const [dispatchOpen, setDispatchOpen] = useState(isOnDispatchPage);
  const [inventoryOpen, setInventoryOpen] = useState(isOnInventoryPage);

  useEffect(() => {
    if (isOnProductPage) setProductOpen(true);
  }, [isOnProductPage]);

  useEffect(() => {
    if (isOnDispatchPage) setDispatchOpen(true);
  }, [isOnDispatchPage]);

  useEffect(() => {
    if (isOnInventoryPage) setInventoryOpen(true);
  }, [isOnInventoryPage]);

  const dispatchSubItems = [
    { name: "Dispatches", href: "/dispatches", icon: Truck },
    { name: "Bin Locations", href: "/locations", icon: MapPin },
  ];

  function renderNavItem(item: NavItem) {
    const isActive = location === item.href;
    const isDispatches = item.href === "/dispatches";

    if (isDispatches && user?.role === "admin") {
      return (
        <div key={item.name}>
          <button
            onClick={() => setDispatchOpen(o => !o)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group",
              isOnDispatchPage
                ? "text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <Truck className={cn("w-4 h-4 flex-shrink-0", isOnDispatchPage ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
            <span className="flex-1 text-left">Dispatches</span>
            <ChevronDown className={cn(
              "w-4 h-4 transition-transform duration-200",
              dispatchOpen ? "rotate-180" : "",
              isOnDispatchPage ? "text-primary" : "text-muted-foreground"
            )} />
          </button>
          <AnimatePresence initial={false}>
            {dispatchOpen && (
              <motion.div
                key="dispatch-group"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="ml-4 pl-3 border-l border-border/60 space-y-0.5 py-1">
                  {dispatchSubItems.map(sub => {
                    const subActive = location === sub.href;
                    return (
                      <Link
                        key={sub.name}
                        href={sub.href}
                        onClick={onNavigate}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative text-sm",
                          subActive
                            ? "text-primary font-semibold"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                        )}
                      >
                        {subActive && (
                          <motion.div
                            layoutId="activeNav"
                            className="absolute inset-0 bg-primary/10 rounded-lg"
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          />
                        )}
                        <sub.icon className={cn("w-4 h-4 relative z-10", subActive ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                        <span className="relative z-10">{sub.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative",
          isActive
            ? "text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
        )}
      >
        {isActive && (
          <motion.div
            layoutId="activeNav"
            className="absolute inset-0 bg-primary/10 rounded-xl"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        )}
        <item.icon className={cn("w-4 h-4 flex-shrink-0 relative z-10", isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
        <span className="relative z-10 truncate">{item.name}</span>
      </Link>
    );
  }

  const beforeProduct = visibleNavItems.filter(i => i.href === "/" || i.href === "/plans");
  const afterProduct = visibleNavItems.filter(i => i.href !== "/" && i.href !== "/plans");
  const beforeInventory = afterProduct.filter(i => i.href === "/suppliers");
  const afterInventory = afterProduct.filter(i => i.href !== "/suppliers");

  return (
    <>
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {beforeProduct.map(renderNavItem)}

        {visibleProductItems.length > 0 && (
          <div>
            <button
              onClick={() => setProductOpen(o => !o)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group",
                isOnProductPage
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <ShoppingBag className={cn("w-4 h-4 flex-shrink-0", isOnProductPage ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
              <span className="flex-1 text-left">Product</span>
              <ChevronDown className={cn(
                "w-4 h-4 transition-transform duration-200",
                productOpen ? "rotate-180" : "",
                isOnProductPage ? "text-primary" : "text-muted-foreground"
              )} />
            </button>

            <AnimatePresence initial={false}>
              {productOpen && (
                <motion.div
                  key="product-group"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="ml-4 pl-3 border-l border-border/60 space-y-0.5 py-1">
                    {visibleProductItems.map(item => {
                      const isActive = item.href.includes("?") ? fullPath === item.href : location === item.href;
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative text-sm",
                            isActive
                              ? "text-primary font-semibold"
                              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                          )}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="activeNav"
                              className="absolute inset-0 bg-primary/10 rounded-lg"
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            />
                          )}
                          <item.icon className={cn("w-4 h-4 relative z-10", isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                          <span className="relative z-10">{item.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {beforeInventory.map(renderNavItem)}

        {visibleInventoryItems.length > 0 && (
          <div>
            <button
              onClick={() => setInventoryOpen(o => !o)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group",
                isOnInventoryPage
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <PackageSearch className={cn("w-4 h-4 flex-shrink-0", isOnInventoryPage ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
              <span className="flex-1 text-left">Inventory</span>
              <ChevronDown className={cn(
                "w-4 h-4 transition-transform duration-200",
                inventoryOpen ? "rotate-180" : "",
                isOnInventoryPage ? "text-primary" : "text-muted-foreground"
              )} />
            </button>
            <AnimatePresence initial={false}>
              {inventoryOpen && (
                <motion.div
                  key="inventory-group"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="ml-4 pl-3 border-l border-border/60 space-y-0.5 py-1">
                    {visibleInventoryItems.map(sub => {
                      const subActive = sub.href.includes("?") ? fullPath === sub.href : location === sub.href;
                      return (
                        <Link
                          key={sub.name}
                          href={sub.href}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative text-sm",
                            subActive
                              ? "text-primary font-semibold"
                              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                          )}
                        >
                          {subActive && (
                            <motion.div
                              layoutId="activeNav"
                              className="absolute inset-0 bg-primary/10 rounded-lg"
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            />
                          )}
                          <sub.icon className={cn("w-4 h-4 relative z-10", subActive ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                          <span className="relative z-10">{sub.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {afterInventory.map(renderNavItem)}
      </nav>

      <div className="px-3 pb-2">
        {bottomNavItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative",
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeNavBottom"
                  className="absolute inset-0 bg-primary/10 rounded-xl"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <item.icon className={cn("w-4 h-4 flex-shrink-0 relative z-10", isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
              <span className="relative z-10 truncate">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const search = useSearch();
  const { state, logout, lockStation } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const { canAccess } = usePagePermissions();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleNavItems = navItems.filter(item =>
    canAccess(user?.role ?? "viewer", item.href)
  );

  const visibleProductItems = productNavItems.filter(item =>
    canAccess(user?.role ?? "viewer", item.href)
  );

  const visibleInventoryItems = inventorySubItems.filter(item =>
    canAccess(user?.role ?? "viewer", item.href)
  );

  const allNavItems = [...navItems, ...productNavItems, ...inventorySubItems, ...bottomNavItems];
  const currentPageName = location === "/locations"
    ? "Bin Locations"
    : location === "/inventory"
      ? "Inventory"
      : (allNavItems.find(n => n.href.split("?")[0] === location)?.name || "Dashboard");

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">

      {/* ── Desktop sidebar (md+) ───────────────────────────────────────── */}
      <aside className="w-52 lg:w-60 xl:w-64 flex-shrink-0 border-r border-border bg-card/50 backdrop-blur-md flex-col hidden md:flex relative z-10">
        <div className="px-4 py-4 flex items-center gap-2.5">
          <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20 p-1.5">
            <img
              src={`${import.meta.env.BASE_URL}tck-logo-short-cream.png`}
              alt="TCK"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-display font-bold text-sm leading-tight tracking-tight text-foreground truncate">The Calzone Kitchen</span>
            <span className="text-xs text-muted-foreground truncate">Production Planner</span>
          </div>
        </div>

        <NavLinks
          visibleNavItems={visibleNavItems}
          visibleProductItems={visibleProductItems}
          visibleInventoryItems={visibleInventoryItems}
          location={location}
          search={search}
          user={user}
        />

        <div className="p-3 border-t border-border">
          <AccountButton user={user} logout={logout} lockStation={lockStation} />
        </div>
      </aside>

      {/* ── Mobile drawer overlay ───────────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setMobileOpen(false)}
            />

            <motion.div
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border flex flex-col md:hidden"
            >
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
                visibleProductItems={visibleProductItems}
                visibleInventoryItems={visibleInventoryItems}
                location={location}
                search={search}
                user={user}
                onNavigate={() => setMobileOpen(false)}
              />

              <div className="p-4 border-t border-border">
                <AccountButton user={user} logout={logout} lockStation={lockStation} onNavigate={() => setMobileOpen(false)} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <TopBar onOpenMobile={() => setMobileOpen(true)} fallbackTitle={currentPageName} />
        <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 relative">
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

      <ReportButton />
    </div>
  );
}

function TopBar({ onOpenMobile, fallbackTitle }: { onOpenMobile: () => void; fallbackTitle: string }) {
  const header = usePageHeaderValue();
  const title = header?.title ?? fallbackTitle;

  return (
    <header className="min-h-[56px] border-b border-border bg-background/80 backdrop-blur-md flex items-center px-4 md:px-5 xl:px-8 gap-3 z-10 min-w-0">
      <button
        onClick={onOpenMobile}
        className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
      >
        <Menu className="w-5 h-5" />
      </button>
      <h1 className="font-display font-bold text-xl text-foreground tracking-tight truncate min-w-0 flex-1">
        {title}
      </h1>
      {header?.description && (
        <span className="hidden lg:block text-sm text-muted-foreground flex-shrink-0 truncate max-w-xs">
          {header.description}
        </span>
      )}
      {header?.action && (
        <div className="flex-shrink-0">
          {header.action}
        </div>
      )}
    </header>
  );
}
