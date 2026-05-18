import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Tag, Wrench } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// Tools landing page
// ──────────────────────────────────────────────────────────────────────────────
// Icon grid for tools that live under Inventory > Tools. Only one tool today
// (Label Stock Check) — add new cards here as we build more.
// ──────────────────────────────────────────────────────────────────────────────

interface Tool {
  href: string;
  label: string;
  description: string;
  Icon: typeof Wrench;
  iconBg: string;
  iconColor: string;
}

const TOOLS: Tool[] = [
  {
    href: "/inventory/tools/label-stock-check",
    label: "Label Stock Check",
    description:
      "Weigh label rolls to estimate stock, then water-fill an order across recipes so every flavour runs out at the same time.",
    Icon: Tag,
    iconBg: "bg-blue-50 dark:bg-blue-950/30",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
];

export default function ToolsPage() {
  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Inventory Tools"
        description="Calculators and one-off utilities for stock and ordering."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map(tool => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${tool.iconBg}`}>
              <tool.Icon className={`w-6 h-6 ${tool.iconColor}`} />
            </div>
            <h3 className="font-semibold text-lg mb-1 group-hover:text-primary">{tool.label}</h3>
            <p className="text-sm text-muted-foreground leading-snug">{tool.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
