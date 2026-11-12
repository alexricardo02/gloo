"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Search, Map, MessageSquare, User, LogIn, Gamepad2, type LucideIcon } from "lucide-react";
import { usePolling } from "@/lib/usePolling";
import { getJson, isUnauthorized } from "@/lib/apiClient";
import { LIST_POLL_MS } from "@/lib/liveUpdates";
import type { UnreadSummary } from "@/lib/apiTypes";

interface NavigationProps {
  isGuest?: boolean;
  onSecureClick?: (e: React.MouseEvent) => void;
}

type NavItem = { id: string; label: string; href: string; icon: LucideIcon };

export default function Navigation({ isGuest, onSecureClick }: NavigationProps) {
  const router = useRouter();
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("Dashboard");

  // BADGE_COUNTS = chats-with-unread: number of my chats with messages from
  // the other side that I have not read yet (server-side, GET /api/unread).
  // Polled every LIST_POLL_MS while visible, and right away on mount/focus.
  const [unreadCount, setUnreadCount] = useState(0);
  usePolling(
    async (signal) => {
      try {
        const summary = await getJson<UnreadSummary>("/api/unread", signal);
        setUnreadCount(summary.chatsWithUnread);
      } catch (error) {
        if (isUnauthorized(error)) {
          setUnreadCount(0);
          return "stop";
        }
        throw error;
      }
    },
    LIST_POLL_MS,
    { enabled: !isGuest },
  );

  const navItems: NavItem[] = [
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

  const handleNavigation = (e: React.MouseEvent, item: NavItem) => {
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