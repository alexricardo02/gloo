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
      <div className="relative bg-[#121212] border border-white/10 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>

        <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center text-white mb-6 border border-white/10">
          <Lock size={28} />
        </div>

        <h3 className="text-2xl font-black italic uppercase tracking-tight mb-3">
          {dashboardT("actionSheetTitle") || "Create an Account"}
        </h3>

        <p className="text-sm text-gray-400 mb-8 leading-relaxed">
          {dashboardT("actionSheetDesc") || "Sign up for free to unlock groups, send messages, and connect with other groups near you."}
        </p>

        <div className="flex flex-col w-full gap-3">
          <Link
            href={`/${locale}/register`}
            data-testid="paywall-register-btn"
            className="w-full bg-white text-black font-black py-4 rounded-full uppercase tracking-widest text-sm hover:scale-[1.02] active:scale-[0.98] transition-transform text-center"
          >
            {dashboardT("actionSheetRegister") || "Sign Up Free"}
          </Link>
          <Link
            href={`/${locale}/login`}
            data-testid="paywall-login-btn"
            className="w-full bg-transparent border border-white/20 text-white font-bold py-4 rounded-full uppercase tracking-widest text-sm hover:bg-white/5 transition-colors text-center"
          >
            {dashboardT("actionSheetLogin") || "Log In"}
          </Link>
        </div>
      </div>
    </div>
  );
}