"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import Navigation from "@/app/components/Navigation";
import GroupCard from "@/app/components/GroupCard";
import TeaserCard from "@/app/components/TeaserCard";
import { getDiscoveryGroups } from "@/app/actions/discoverGroups";
import { getGroupByUser } from "@/app/actions/group";
import { checkIsGuest } from "@/app/actions/guest";
import {
  MapPin,
  SlidersHorizontal,
  ChevronRight,
  X,
  Users,
  Lock,
} from "lucide-react";
import GuestPaywall from "@/app/components/GuestPaywall";
import PageHeader from "@/app/components/PageHeader";
import type { DiscoveryGroupDTO, DiscoveryTeaserCardDTO } from "@/lib/apiTypes";

const DEFAULT_RADIUS_KM = 10;

export default function PrePartyPage() {
  const locale = useLocale();
  const t = useTranslations("SearchGroups");
  const dashboardT = useTranslations("Dashboard");

  const [groups, setGroups] = useState<DiscoveryGroupDTO[]>([]);
  // D5: placeholder cards for guests and users without a group (no real data).
  const [teaser, setTeaser] = useState<DiscoveryTeaserCardDTO[]>([]);
  const [distance, setDistance] = useState(DEFAULT_RADIUS_KM);

  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [isDistanceModalOpen, setIsDistanceModalOpen] = useState(false);
  const [tempDistance, setTempDistance] = useState(distance);

  const [hasNoGroup, setHasNoGroup] = useState(false);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);

  const [isGuest, setIsGuest] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const [isReady, setIsReady] = useState(false);

  const lastGroupElementRef = useRef<HTMLDivElement | null>(null);

  // B3: pagination state lives in refs so the observer and overlapping
  // requests always see the latest values. Every reset bumps requestIdRef;
  // responses of older requests are dropped, so a slow first page can never
  // be appended after (or on top of) a newer one.
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);

  const loadPage = useCallback(async (radius: number, reset: boolean) => {
    if (!reset && (inFlightRef.current || !hasMoreRef.current)) return;
    const requestId = ++requestIdRef.current;
    inFlightRef.current = true;
    if (reset) cursorRef.current = null;
    setLoading(true);

    try {
      const result = await getDiscoveryGroups({
        distance: radius,
        cursor: cursorRef.current ?? undefined,
      });
      if (requestId !== requestIdRef.current) return;

      // An invalid or stale cursor ends the feed; it never restarts it.
      const page = result.ok ? result.data : null;
      if (!page || page.hasNoGroup) {
        cursorRef.current = null;
        hasMoreRef.current = false;
        setHasMore(false);
        if (page?.hasNoGroup) {
          setGroups([]);
          setTeaser(page.teaser);
        } else if (reset) {
          setGroups([]);
        }
        return;
      }

      setTeaser([]);
      setGroups((prev) => (reset ? page.groups : [...prev, ...page.groups]));
      cursorRef.current = page.nextCursor;
      hasMoreRef.current = page.nextCursor !== null;
      setHasMore(page.nextCursor !== null);
    } catch (error) {
      console.error("Error loading discovery feed:", error);
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    async function init() {
      const guestStatus = await checkIsGuest();
      setIsGuest(guestStatus);

      const savedDistance = localStorage.getItem("gloo_search_radius");
      let radius = DEFAULT_RADIUS_KM;

      if (!guestStatus) {
        const userGroup = await getGroupByUser();

        if (!userGroup) {
          setHasNoGroup(true);
        } else {
          setHasNoGroup(false);
          if (savedDistance) {
            radius = Number(savedDistance);
            setDistance(radius);
            setTempDistance(radius);
          } else {
            const defaultDistance = userGroup.maxDistance || 10;
            radius = defaultDistance;
            setDistance(defaultDistance);
            setTempDistance(defaultDistance);
          }
        }
      } else {
        if (savedDistance) {
          radius = Number(savedDistance);
          setDistance(radius);
          setTempDistance(radius);
        }
      }
      setIsReady(true);
      // First page only once the saved radius is known (B3: no second,
      // overlapping "first page" request with the default radius).
      void loadPage(radius, true);
    }
    init();
  }, [loadPage]); // loadPage is stable: runs once on mount.

  useEffect(() => {
    const lastCard = lastGroupElementRef.current;
    if (loading || hasNoGroup || !hasMore || !lastCard) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) void loadPage(distance, false);
    });
    observer.observe(lastCard);
    return () => observer.disconnect();
  }, [loading, hasMore, groups, hasNoGroup, distance, loadPage]);

  const handleInteractionAttempt = () => {
    if (isGuest) {
      setShowPaywall(true);
    } else if (hasNoGroup) {
      setIsBlockModalOpen(true);
    }
  };

  const openDistanceModal = () => {
    setTempDistance(distance);
    setIsDistanceModalOpen(true);
  };

  const applyDistance = () => {
    setDistance(tempDistance);
    localStorage.setItem("gloo_search_radius", tempDistance.toString());
    void loadPage(tempDistance, true);

    setIsDistanceModalOpen(false);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background overflow-hidden relative text-foreground font-sans selection:bg-primary selection:text-on-primary pt-[116px]">
      
      <PageHeader
        title={t("title") || "Discover"}
        subtitle={`${isReady ? `${distance} km` : "— km"} ${t("kmAroundYou")}`}
        actions={
          <button
            onClick={openDistanceModal}
            data-testid="radius-open-btn"
            className="flex items-center gap-2 bg-card border border-border px-4 py-2 rounded-full hover:bg-muted transition-colors cursor-pointer"
          >
            <SlidersHorizontal size={14} className="text-primary" />
            <span className="text-[10px] font-black uppercase tracking-wider text-foreground">
              Radius
            </span>
          </button>
        }
      />

      <main className="flex-1 w-full overflow-y-scroll snap-y snap-mandatory scroll-smooth no-scrollbar relative">
        
        {(hasNoGroup || isGuest) && (
          <div
            className="absolute inset-0 z-30 cursor-pointer"
            onClick={handleInteractionAttempt}
          />
        )}

        {groups.map((group, index) => {
          const isLastElement = index === groups.length - 1;
          return (

            <div
              key={group.id}
              ref={isLastElement ? lastGroupElementRef : null}
              className={`h-full w-full snap-center snap-always relative pb-24 ${isGuest ? "blur-xl select-none" : ""}`}
            >
              <GroupCard group={group} />
            </div>
          );
        })}

        {teaser.map((card) => (
          <div
            key={card.id}
            className="h-full w-full snap-center snap-always relative pb-24 blur-xl select-none"
            aria-hidden="true"
          >
            <TeaserCard card={card} />
          </div>
        ))}

        {!loading && groups.length === 0 && teaser.length === 0 && (
          <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center snap-center pb-24">
            <div className="w-20 h-20 bg-card rounded-full border border-border flex items-center justify-center mb-6">
              <MapPin size={32} className="text-primary" />
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tight mb-2">
              {t("emptyTitle")}
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-[280px]">
              {t("emptyDesc")}
            </p>
            <Link
              href={`/${locale}/profile/create-group`}
              className="mt-8 px-8 py-3 rounded-full bg-primary text-on-primary text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity inline-block text-center"
            >
              {t("preferences")}
            </Link>
          </div>
        )}
      </main>

      <Navigation
        isGuest={isGuest}
        onSecureClick={() => setShowPaywall(true)}
      />

      {/* Modals handle radius adjustment, missing-group flow, and guest paywall */}
      {isDistanceModalOpen && (
        <div data-testid="radius-modal" className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-end justify-center animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-t-[2.5rem] p-8 border-t border-border animate-in slide-in-from-bottom-8 duration-300 pb-12">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-black uppercase tracking-tight">
                {t("modalTitle")}
              </h3>
              <button
                onClick={() => setIsDistanceModalOpen(false)}
                className="p-2 bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-10">
              <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-primary mb-4">
                <span>1 KM</span>
                <span>{tempDistance} KM</span>
                <span>50 KM</span>
              </div>
              <input
                type="range"
                data-testid="radius-slider"
                min="1"
                max="50"
                value={tempDistance}
                onChange={(e) => setTempDistance(Number(e.target.value))}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <button
              onClick={applyDistance}
              data-testid="radius-apply-btn"
              className="w-full bg-accent text-on-accent font-black py-4 rounded-full uppercase tracking-widest text-sm hover:scale-[1.02] active:scale-[0.98] transition-transform cursor-pointer"
            >
              {t("modalButton")}
            </button>
          </div>
        </div>
      )}

      {isBlockModalOpen && !isGuest && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative bg-card border border-border w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <button
              onClick={() => setIsBlockModalOpen(false)}
              className="absolute top-6 right-6 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X size={24} />
            </button>

            <div className="w-16 h-16 bg-secondary/10 rounded-2xl flex items-center justify-center text-secondary mb-6 border border-secondary/20">
              <Users size={28} />
            </div>

            <h3 className="text-2xl font-black italic uppercase tracking-tight mb-3">
              {t("groupRequiredTitle") || "Group Required"}
            </h3>

            <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
              {t("groupRequiredDesc") ||
                "To match, like, send messages, or unlock more groups near you, you must create a profile for your own group first."}
            </p>

            <Link
              href={`/${locale}/profile/create-group`}
              data-testid="create-group-modal-link"
              className="w-full bg-accent text-on-accent font-black py-4 rounded-full uppercase tracking-widest text-sm hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-accent/20 text-center"
            >
              {t("createGroupButton") || "Create Profile"}
            </Link>
          </div>
        </div>
      )}

      {showPaywall && isGuest && (
        <GuestPaywall onClose={() => setShowPaywall(false)} />
      )}
    </div>
  );
}
