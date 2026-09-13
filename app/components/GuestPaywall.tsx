"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Lock, X } from "lucide-react";

interface GuestPaywallProps {
  onClose: () => void;
}

export default function GuestPaywall({ onClose }: GuestPaywallProps) {
  const locale = useLocale();
  const dashboardT = useTranslations("Dashboard");

  return (
    <div data-testid="guest-paywall-modal" className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative bg-card border border-border w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-6 right-6 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X size={24} />
        </button>

        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6 border border-primary/20">
          <Lock size={28} />
        </div>

        <h3 className="text-2xl font-black italic uppercase tracking-tight mb-3 text-foreground">
          {dashboardT("actionSheetTitle") || "Create an Account"}
        </h3>

        <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
          {dashboardT("actionSheetDesc") || "Sign up for free to unlock groups, send messages, and connect with other groups near you."}
        </p>

        <div className="flex flex-col w-full gap-3">
          <Link
            href={`/${locale}/register`}
            data-testid="paywall-register-btn"
            className="w-full bg-accent text-on-accent font-black py-4 rounded-full uppercase tracking-widest text-sm hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-accent/20 text-center cursor-pointer"
          >
            {dashboardT("actionSheetRegister") || "Sign Up Free"}
          </Link>
          <Link
            href={`/${locale}/login`}
            data-testid="paywall-login-btn"
            className="w-full bg-transparent border border-border text-foreground font-bold py-4 rounded-full uppercase tracking-widest text-sm hover:bg-muted transition-colors text-center cursor-pointer"
          >
            {dashboardT("actionSheetLogin") || "Log In"}
          </Link>
        </div>
      </div>
    </div>
  );
}