/**
 * A link on a to-do or a sub-task. Websites open in a new tab. A page of this
 * app:
 *   - in the docked panel ("app") moves the app to it and leaves the panel
 *     open on the to-do — the point of the panel;
 *   - in the panel inside the Create Plan dialog ("tab") opens a new tab, so
 *     the plan being made isn't left behind;
 *   - anywhere else is a plain same-tab link. The full-screen list sits on
 *     top of the app, so moving the app underneath would leave it covering
 *     the page; a full load closes it.
 */
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { opensInApp, resolveTodoLink } from "@/lib/todo-link";

export type TodoLinkMode = "load" | "app" | "tab";

const LinkMode = createContext<TodoLinkMode>("load");

export function TodoLinks({ mode, children }: { mode: TodoLinkMode; children: ReactNode }) {
  return <LinkMode.Provider value={mode}>{children}</LinkMode.Provider>;
}

export function TodoAnchor({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  const mode = useContext(LinkMode);
  const [location, navigate] = useLocation();
  const { href, external } = resolveTodoLink(url);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (mode !== "app" || external || e.metaKey || e.ctrlKey || e.shiftKey || !opensInApp(href, location)) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <a href={href} {...(external || mode === "tab" ? { target: "_blank", rel: "noopener noreferrer" } : {})} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
