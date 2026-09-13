"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Search, Map, MessageSquare, User, LogIn, Gamepad2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface NavigationProps {
  isGuest?: boolean;
  onSecureClick?: (e: React.MouseEvent) => void;
}

export default function Navigation({ isGuest, onSecureClick }: NavigationProps) {
  const router = useRouter();
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("Dashboard");

  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (pathname.includes(`/${locale}/messages`)) {
      setUnreadCount(0);
    }

    const channel = supabase
      .channel("global_navigation_notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "Message" },
        () => {
          if (!pathname.includes(`/${locale}/messages`)) {
            setUnreadCount((prev) => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pathname, locale]);

  const navItems = [
    {
      id: "discover",
      label: t("navGroups"),
      href: `/${locale}/search-groups`,
      icon: Search,
    },
    {
      id: "games",
      label: t("enterGames") || "Games",
      href: `/${locale}/games`,
      icon: Gamepad2,
    },
    {
      id: "map",
      label: t("navMap"),
      href: `/${locale}/map`,
      icon: Map,
    },
    {
      id: "messages",
      label: t("navMessages"),
      href: `/${locale}/messages`,
      icon: MessageSquare,
    },
    {
      id: "profile",
      label: t("navProfile"),
      href: `/${locale}/profile`,
      icon: User,
    },
  ];

  const handleNavigation = (e: React.MouseEvent, item: any) => {
    e.preventDefault();
    if (isGuest && (item.id === "messages" || item.id === "profile")) {
      if (onSecureClick) {
        onSecureClick(e);
      } else {
        router.push(`/${locale}/search-groups?showPaywall=true`);
      }
      return;
    }

    router.push(item.href);
  };



  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-lg border-t border-border z-40 px-4 pt-3 safe-bottom" role="tablist">
      <div className="max-w-md mx-auto flex justify-between items-center">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isMessagesTab = item.icon === MessageSquare;

          return (
            <button
              key={item.href}
              onClick={(e) => handleNavigation(e, item)}
              data-testid={`nav-tab-${item.id}`}
              role="tab"
              aria-label={item.label}
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              className="flex flex-col items-center justify-center flex-1 min-w-0 min-h-12 transition-all duration-200 relative group bg-transparent border-none cursor-pointer"
            >
              <div
                className={`p-2 rounded-xl transition-all duration-200 relative ${isActive
                    ? "text-primary scale-110"
                    : "text-muted-foreground group-hover:text-foreground"
                  }`}
              >
                <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />

                {isMessagesTab && unreadCount > 0 && (
                  <div data-testid="unread-badge" className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-0.5 bg-secondary text-on-secondary text-[10px] font-black flex items-center justify-center rounded-full border-2 border-background animate-in zoom-in">
                    {unreadCount}
                  </div>
                )}
              </div>

              {isActive && (
                <div className="absolute -top-3 w-8 h-0.5 bg-primary rounded-full shadow-[0_0_10px_var(--color-primary)]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}