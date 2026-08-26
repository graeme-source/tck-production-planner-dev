import React, { ReactNode, useState, useEffect, useRef } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { RecordImprovementModal } from "@/components/record-improvement-modal";
import { RecordIssueModal } from "@/components/record-issue-modal";
import { PullKanbanModal } from "@/components/pull-kanban-modal";
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
  AlertTriangle,
  FileText,
  Wrench,
  MessagesSquare,
  Scan,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { NotificationBell } from "@/components/notification-bell";
import { CurrentUserBadge } from "@/components/current-user-badge";
import { LeanWeeklyStrip } from "@/components/lean-weekly-review";
import { NotificationFlash } from "@/components/notification-flash";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";
import { FoundersAssistant, ASSISTANT_NAME } from "@/components/founders-assistant";
import { TodoSheet, TodoInterstitial, useMyOpenTodoCount } from "@/components/todo-lists";
import { DptSuggestionPrompt } from "@/components/dpt-suggestion-prompt";
import { BookOpen, Bot, GraduationCap, ChevronLeft, ChevronRight, ListTodo, ScanLine } from "lucide-react";

export type NavItem = { name: string; href: string; icon: React.ComponentType<{ className?: string }> };

export const navItems: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Production Plans", href: "/plans", icon: CalendarDays },
  { name: "Dispatches", href: "/dispatches", icon: Truck },
  { name: "Suppliers", href: "/suppliers", icon: Building2 },
  { name: "Improvements", href: "/improvements", icon: TrendingUp },
  { name: "Training", href: "/training", icon: GraduationCap },
  { name: "Analytics", href: "/reports", icon: BarChart2 },
];

export const inventorySubItems: NavItem[] = [
  { name: "Ingredients", href: "/inventory?tab=ingredients", icon: Carrot },
  { name: "Supplies", href: "/inventory?tab=supplies", icon: Box },
  { name: "Stock Control", href: "/stock-control", icon: PackageSearch },
  { name: "Orders", href: "/orders", icon: ShoppingCart },
  { name: "Deliveries", href: "/deliveries", icon: PackageCheck },
  { name: "Tools", href: "/inventory/tools", icon: Wrench },
];

const INVENTORY_PATHS = ["/inventory", "/orders", "/deliveries", "/stock-control"];
// Routes that count as "inside Inventory" for the auto-expand logic. Anything
// under /inventory/... (e.g. /inventory/tools, /inventory/tools/label-stock-check)
// should keep the sidebar group expanded.
const isInventoryRoute = (loc: string) =>
  INVENTORY_PATHS.includes(loc) || loc.startsWith("/inventory/");

export const productNavItems: NavItem[] = [
  { name: "Recipes", href: "/recipes", icon: ChefHat },
  { name: "Sub-Recipes", href: "/sub-recipes", icon: ClipboardList },
  { name: "Ingredients", href: "/inventory?tab=ingredients", icon: Carrot },
  { name: "Product Hub", href: "/product-hub", icon: Beaker },
  { name: "Surveys", href: "/surveys", icon: MessagesSquare },
];

export const bottomNavItems: NavItem[] = [
  { name: "Lean Cave", href: "/lean-cave", icon: Lightbulb },
  { name: "Settings", href: "/settings", icon: Settings },
];

const PRODUCT_PATHS = ["/recipes", "/sub-recipes", "/inventory", "/product-hub", "/surveys"];
const DISPATCH_PATHS = ["/dispatches", "/locations", "/fulfilment", "/case-orders"];

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
              href="/hub"
              onClick={() => { setOpen(false); onNavigate?.(); }}
              className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-secondary/50 transition-colors"
            >
              <FileText className="w-4 h-4 text-muted-foreground" />
              My Employee Hub
            </Link>
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
  const isOnInventoryPage = isInventoryRoute(location);
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
    { name: "Order Packing Live", href: "/fulfilment", icon: Scan },
    { name: "Case Orders", href: "/case-orders", icon: Box },
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
  // Collapsible sidebar on tablet/desktop too — the hamburger in the top bar
  // is always visible, so getting it back is one obvious tap. Choice sticks
  // across sessions.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("tck-sidebar-collapsed") === "1",
  );
  function handleMenuButton() {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setSidebarCollapsed(c => {
        localStorage.setItem("tck-sidebar-collapsed", c ? "0" : "1");
        return !c;
      });
    } else {
      setMobileOpen(true);
    }
  }
  // SOPs dialog state lives at the Layout root (rather than inside TopBar)
  // because the header has backdrop-blur, which creates a stacking context
  // that traps any fixed-position child's z-index inside it. Rendering the
  // dialog as a sibling of <main> keeps it above everything.
  const [sopsOpen, setSopsOpen] = useState(false);
  // Dock state now lives inside QuickActionsDock so station pages (which
  // render outside Layout) can mount the same thing.

  const userRole = user?.role ?? "viewer";
  const isManagerOrAdmin = userRole === "admin" || userRole === "manager";

  const visibleNavItems = navItems
    .filter(item => canAccess(userRole, item.href))
    .map(item => {
      // Viewers only see Issue Log on the reports page, so rename the nav item
      if (item.href === "/reports" && !isManagerOrAdmin) {
        return { ...item, name: "Issue Log", icon: AlertTriangle };
      }
      return item;
    });

  const visibleProductItems = productNavItems.filter(item =>
    canAccess(userRole, item.href)
  );

  const visibleInventoryItems = inventorySubItems.filter(item =>
    canAccess(userRole, item.href)
  );

  const allNavItems = [...navItems, ...productNavItems, ...inventorySubItems, ...bottomNavItems];
  const currentPageName = location === "/locations"
    ? "Bin Locations"
    : location === "/inventory"
      ? "Inventory"
      : (allNavItems.find(n => n.href.split("?")[0] === location)?.name || "Dashboard");

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">

      {/* ── Desktop sidebar (md+, collapsible via the top-bar hamburger) ── */}
      <aside className={`w-52 lg:w-60 xl:w-64 flex-shrink-0 border-r border-border bg-card/50 backdrop-blur-md flex-col hidden relative z-10 ${sidebarCollapsed ? "" : "md:flex"}`}>
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
        <TopBar onMenu={handleMenuButton} fallbackTitle={currentPageName} onOpenSops={() => setSopsOpen(true)} />
        <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-[200px] relative">
          {/* Weekly lean lesson reminder — every main page, until completed */}
          <div className="mb-4 empty:hidden">
            <LeanWeeklyStrip />
          </div>
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {children}
          </motion.div>
        </div>
      </main>

      <StandardsSopsDialog open={sopsOpen} onClose={() => setSopsOpen(false)} currentStationType={null} />
      <NotificationFlash />

      {/* Caz is available to every logged-in user. The founder additionally
          gets recipe-design + memory powers; staff get a read-only look-up
          assistant (enforced server-side, not just here). */}
      <QuickActionsDock />
      {/* Weekly sales-derived DPT refresh — renders nothing except for
          managers/admins in the week it's due. */}
      <DptSuggestionPrompt />
    </div>
  );
}

/**
 * The quick-actions dock: the edge tab (My to-dos · Quick Idea · Ask Caz),
 * Caz herself, the to-do sheet and the unacknowledged-task interstitial.
 *
 * Self-contained so it can be mounted BOTH inside Layout and on full-screen
 * pages that render outside it — station screens had no dock at all, which
 * is where the team spends the day (Graeme, 2026-08-28). Deliberately not
 * mounted on the visitor kiosk or print views: the kiosk is handed to
 * members of the public, so app nav must stay unreachable there.
 */
export function QuickActionsDock() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);
  const [improvementOpen, setImprovementOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const isFounder = user?.email === "graeme@thecalzonekitchen.co.uk";

  if (!user) return null;

  return (
    <>
      <FoundersAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} isFounder={isFounder} />
      <FloatingActionsTab
        assistantOpen={assistantOpen}
        onOpenAssistant={() => setAssistantOpen(true)}
        onOpenTodos={() => setTodosOpen(true)}
        onOpenImprovement={() => setImprovementOpen(true)}
        onOpenIssue={() => setIssueOpen(true)}
        onOpenKanban={() => setKanbanOpen(true)}
      />
      <RecordImprovementModal open={improvementOpen} onClose={() => setImprovementOpen(false)} />
      <RecordIssueModal open={issueOpen} onClose={() => setIssueOpen(false)} />
      <PullKanbanModal open={kanbanOpen} onClose={() => setKanbanOpen(false)} />
      <TodoSheet open={todosOpen} onClose={() => setTodosOpen(false)} />
      <TodoInterstitial />
    </>
  );
}

// Quick Idea + Ask Caz, folded into one edge tab so they stay off the
// content (they used to float over table footers and totals). ALWAYS starts
// collapsed: it used to be remembered per device, which meant any tablet
// where someone once expanded it greeted every later user with the menu
// already open (Graeme, 2026-08-22). Expansion now lasts only until the
// next full page load.
function FloatingActionsTab({ assistantOpen, onOpenAssistant, onOpenTodos, onOpenImprovement, onOpenIssue, onOpenKanban }: {
  assistantOpen: boolean;
  onOpenAssistant: () => void;
  onOpenTodos: () => void;
  onOpenImprovement: () => void;
  onOpenIssue: () => void;
  onOpenKanban: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded(prev => !prev);
  const openTodoCount = useMyOpenTodoCount();

  return (
    <div className="fixed right-0 top-[38%] z-40 flex items-start">
      {expanded ? (
        <div className="flex flex-col items-end gap-2 pr-3">
          <button
            type="button"
            onClick={toggle}
            aria-label="Tuck the quick actions away"
            title="Tuck away"
            className="w-8 h-8 rounded-full border border-border bg-card/95 shadow flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {/* All three actions share one width so the stack reads as a menu,
              not three stray buttons. */}
          <button
            type="button"
            onClick={onOpenTodos}
            className="w-44 flex items-center justify-center gap-2 px-4 h-12 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:opacity-90 active:scale-95 transition-all"
            aria-label="My to-dos"
            title="My to-dos"
          >
            <ListTodo className="w-5 h-5" />
            <span className="text-sm font-semibold">My to-dos</span>
            {openTodoCount > 0 && (
              <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-white/25 text-xs font-bold flex items-center justify-center tabular-nums">
                {openTodoCount}
              </span>
            )}
          </button>
          {/* Record Improvement replaced Quick Idea (Graeme, 2026-08-28):
              the dock is where people actually reach for this, and the
              improvement flow needs a photo taken at the point of work.
              Record Issue sits beside it so a problem and an improvement are
              equally easy to raise — a safety issue is often both. */}
          <button
            type="button"
            onClick={onOpenImprovement}
            className="w-44 flex items-center justify-center gap-2 px-4 h-12 rounded-full bg-blue-500 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-600 active:scale-95 transition-all"
            aria-label="Record an improvement"
            title="Record an improvement"
          >
            <Lightbulb className="w-5 h-5" />
            <span className="text-sm font-semibold">Improvement</span>
          </button>
          <button
            type="button"
            onClick={onOpenIssue}
            className="w-44 flex items-center justify-center gap-2 px-4 h-12 rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/30 hover:bg-rose-600 active:scale-95 transition-all"
            aria-label="Report an issue"
            title="Report an issue"
          >
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm font-semibold">Report issue</span>
          </button>
          <button
            type="button"
            onClick={onOpenKanban}
            className="w-44 flex items-center justify-center gap-2 px-4 h-12 rounded-full bg-violet-500 text-white shadow-lg shadow-violet-500/30 hover:bg-violet-600 active:scale-95 transition-all"
            aria-label="Pull a kanban"
            title="Pull a kanban"
          >
            <ScanLine className="w-5 h-5" />
            <span className="text-sm font-semibold">Pull kanban</span>
          </button>
          {!assistantOpen && (
            <button
              type="button"
              onClick={onOpenAssistant}
              className="w-44 flex items-center justify-center gap-2 px-4 h-12 rounded-full bg-orange-500 text-white shadow-lg shadow-orange-500/30 hover:bg-orange-600 active:scale-95 transition-all"
              aria-label={`Ask ${ASSISTANT_NAME}`}
              title={`Ask ${ASSISTANT_NAME}`}
            >
              <Bot className="w-5 h-5" />
              <span className="text-sm font-semibold">Ask {ASSISTANT_NAME}</span>
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Show quick actions — My to-dos, Quick Idea and Ask ${ASSISTANT_NAME}`}
          title={`My to-dos · Quick Idea · Ask ${ASSISTANT_NAME}`}
          className="h-16 w-8 rounded-l-xl border border-r-0 border-border bg-card/80 backdrop-blur-sm shadow-lg flex flex-col items-center justify-center gap-1 hover:w-9 transition-all relative"
        >
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          <span className="w-2.5 h-2.5 rounded-full bg-primary" />
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
          {openTodoCount > 0 && (
            <span className="absolute -top-1.5 -left-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center tabular-nums shadow">
              {openTodoCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

function TopBar({ onMenu, fallbackTitle, onOpenSops }: { onMenu: () => void; fallbackTitle: string; onOpenSops: () => void }) {
  const header = usePageHeaderValue();
  const title = header?.title ?? fallbackTitle;

  return (
    <header className="min-h-[56px] border-b border-border bg-background/80 backdrop-blur-md flex items-center px-4 md:px-5 xl:px-8 gap-3 z-10 min-w-0">
      {/* Always visible: opens the drawer on phones, collapses/restores the
          sidebar on tablet/desktop — one obvious place to get the menu back. */}
      <button
        onClick={onMenu}
        aria-label="Toggle menu"
        title="Toggle menu"
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
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
      <CurrentUserBadge />
      <button
        onClick={onOpenSops}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors flex-shrink-0"
        title="Standards & SOPs"
      >
        <BookOpen className="w-4 h-4" />
        <span className="hidden sm:inline">SOPs</span>
      </button>
      <NotificationBell />
      {header?.action && (
        <div className="flex-shrink-0">
          {header.action}
        </div>
      )}
    </header>
  );
}
