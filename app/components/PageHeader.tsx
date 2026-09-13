import React, { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export default function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-30 bg-card/90 backdrop-blur-md border-b border-border px-6 pt-12 pb-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black italic uppercase tracking-tight text-foreground truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-muted-foreground text-xs font-bold mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center shrink-0">
            {actions}
          </div>
        )}
      </div>
      {children && (
        <div className="mt-4">
          {children}
        </div>
      )}
    </header>
  );
}
