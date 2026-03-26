import { type ReactNode } from "react";
import { useSetPageHeader } from "@/contexts/page-header-context";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  useSetPageHeader(title, description, action);
  return null;
}
