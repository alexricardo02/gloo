"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Heart, MessageCircle, Loader2, Flag, Check } from "lucide-react";
import { toggleLike } from "@/app/actions/discoverGroups";
import { getOrCreateChat } from "@/app/actions/chat";
import { reportGroupByGroupIdAction } from "@/app/actions/moderation";

interface GroupCardProps {
  group: any;
}

export default function GroupCard({ group }: GroupCardProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Profile");

  const [currentIndex, setCurrentIndex] = useState(0);
  const [liked, setLiked] = useState(Boolean(group.likedByCurrentUser));
  const [isAnimating, setIsAnimating] = useState(false);
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const photos: string[] =
    group.photos && group.photos.length > 0
      ? group.photos
      : ["/images/bg-fallback.jpg"];

  const goNext = () => setCurrentIndex((i) => Math.min(i + 1, photos.length - 1));
  const goPrev = () => setCurrentIndex((i) => Math.max(i - 1, 0));

  const handleLike = async (id: string) => {
    const nextLiked = !liked;
    setLiked(nextLiked);
    setIsAnimating(true);

    try {
      await toggleLike(id);
    } catch (error) {
      console.error("Error liking group:", error);
      setLiked(!nextLiked);
    } finally {
      window.setTimeout(() => setIsAnimating(false), 180);
    }
  };

  // ── Swipe support (no preventDefault — not needed with the translate approach) ──
  // We register on the container to detect horizontal swipes on touchend.
  // Because we don't call preventDefault(), vertical gestures still bubble
  // to the parent's vertical scroll without any conflict.
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    const THRESHOLD = 50;

    if (Math.abs(dx) > THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  return (
    <div
      className="relative h-full w-full rounded-[2.5rem] overflow-hidden shadow-2xl bg-[#1A1A1A]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >

      <div className="absolute inset-0 overflow-hidden bg-black">
        {photos.map((photo: string, index: number) => (
          <div
            key={index}
            className="absolute inset-0 w-full h-full transition-transform duration-300 ease-out will-change-transform"
            style={{ transform: `translateX(${(index - currentIndex) * 100}%)` }}
          >
            <img
              src={photo}
              alt={`Foto ${index + 1}`}
              className="w-full h-full object-contain select-none"
              draggable="false"
            />
          </div>
        ))}
      </div>

      <div className="absolute top-4 left-4 right-4 flex gap-1 z-30 pointer-events-none">
        {photos.map((_: string, index: number) => (
          <div
            key={index}
            className="flex-1 h-[3px] rounded-full overflow-hidden bg-white/30"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${index === currentIndex
                  ? "bg-white w-full"
                  : index < currentIndex
                    ? "bg-white w-full"
                    : "bg-transparent w-0"
                }`}
            />
          </div>
        ))}
      </div>

      {photos.length > 1 && (
        <div className="absolute inset-0 z-20 flex">
          <div className="w-1/3 h-full cursor-pointer" onClick={goPrev} />
          <div className="w-2/3 h-full cursor-pointer" onClick={goNext} />
        </div>
      )}

      <div className="absolute top-0 left-0 p-6 pt-8 flex flex-col items-start text-left max-w-[85%] space-y-2 z-40 pointer-events-none">
        {" "}
        <h2 className="text-3xl font-extrabold text-white tracking-tighter drop-shadow-lg">
          {group.user?.username || group.user?.name || "Group"}
        </h2>
        <div className="flex flex-wrap gap-2">
          <span className="bg-[#FF725E]/20 backdrop-blur-md border border-[#FF725E]/30 text-[#FF725E] px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">
            {group.gender}
          </span>
          <span className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-white">
            {group.membersCount} {t("members")}
          </span>
          <span className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-white">
            {group.ageMin}-{group.ageMax}
          </span>
        </div>
        <p className="text-sm text-gray-100 line-clamp-3 drop-shadow-md font-medium mt-1">
          {group.description || t("defaultDescription")}
        </p>
      </div>

      <div className="absolute bottom-0 right-0 p-4 pb-8 flex flex-col gap-4 items-end z-40 pointer-events-auto">
        <button
          type="button"
          onClick={async () => {
            if (isReporting || reportSent) return;
            setIsReporting(true);
            try {
              await reportGroupByGroupIdAction(group.id);
              setReportSent(true);
              setTimeout(() => setReportSent(false), 3000);
            } catch (err) {
              console.error("Failed to report group:", err);
            } finally {
              setIsReporting(false);
            }
          }}
          className={`p-3 rounded-full border border-white/20 shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-all duration-200 ${reportSent
              ? "bg-green-500/20 border-green-500/30"
              : "bg-white/5 hover:bg-white/20"
            }`}
          aria-label="Report group"
        >
          {isReporting ? (
            <Loader2 size={18} className="animate-spin text-yellow-400" />
          ) : reportSent ? (
            <Check size={18} className="text-green-400" />
          ) : (
            <Flag size={18} className="text-yellow-400" />
          )}
        </button>
        <button
          type="button"
          onClick={() => handleLike(group.id)}
          aria-pressed={liked}
          className={`p-4 rounded-full border border-white/20 bg-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:bg-white/20 transition-all duration-200 ${isAnimating ? "scale-95" : ""
            }`}
        >
          <Heart
            size={26}
            fill={liked ? "#FF725E" : "none"}
            className={liked ? "text-[#FF725E]" : "text-white"}
          />
        </button>
        <button
          type="button"
          onClick={async () => {
            if (isOpeningChat) return;
            setIsOpeningChat(true);
            try {
              const targetUserId = group.user?.id;
              if (!targetUserId) return;
              const result = await getOrCreateChat(targetUserId);
              if (result.success && result.chatId) {
                router.push(`/${locale}/messages/${result.chatId}`);
              }
            } catch (err) {
              console.error("Failed to open chat:", err);
            } finally {
              setIsOpeningChat(false);
            }
          }}
          disabled={isOpeningChat}
          className="p-4 bg-[#FF725E] rounded-full shadow-[0_0_20px_rgba(255,114,94,0.5)] hover:scale-110 transition-all disabled:opacity-70 disabled:scale-100"
        >
          {isOpeningChat ? (
            <Loader2 className="text-black animate-spin" size={26} />
          ) : (
            <MessageCircle className="text-black" fill="black" size={26} />
          )}
        </button>
      </div>
    </div>
  );
}