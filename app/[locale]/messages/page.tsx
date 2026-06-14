"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Navigation from "@/app/components/Navigation";
import LikedMeCard from "@/app/components/LikedMeCard";
import { Search, MoreVertical, CheckCheck, Loader2, Heart, Map, List, Shield, Flag, X } from "lucide-react";
import Image from "next/image";
import { getActiveChats } from "@/app/actions/chat";
import { getGroupsThatLikedMe } from "@/app/actions/discoverGroups";
import { getBlockedGroupsAction, unblockGroupAction } from "@/app/actions/moderation";
import { supabase } from "@/lib/supabase";

type ChatPreview = {
  id: string;
  name: string;
  lastMessage: string;
  time: Date | string;
  unread: number;
  image: string;
  isMatch?: boolean;
};

type LikedGroup = {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string;
    image: string | null;
    username: string | null;
  };
  photos: string[];
  description: string | null;
  membersCount: number;
  gender: string;
  ageMin: number;
  ageMax: number;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  likedByCurrentUser: boolean;
  isMutualLike: boolean;
};

export default function MessagesPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Messages");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"chats" | "likes">("chats");

  // Chat states
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);

  // Likes states
  const [likedGroups, setLikedGroups] = useState<LikedGroup[]>([]);
  const [isLoadingLikes, setIsLoadingLikes] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

  // Map component dynamic import
  const [MapComponent, setMapComponent] = useState<any>(null);

  // Blocked groups state
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockedModalOpen, setBlockedModalOpen] = useState(false);
  const [blockedGroups, setBlockedGroups] = useState<any[]>([]);
  const [isLoadingBlocked, setIsLoadingBlocked] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".header-menu-container")) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Load chats
  const loadChats = useCallback(async () => {
    const response = await getActiveChats();
    if (response.success && response.chats) {
      setChats(response.chats as ChatPreview[]);
    }
    setIsLoadingChats(false);
  }, []);

  // Load groups that liked me
  const loadLikedGroups = useCallback(async () => {
    setIsLoadingLikes(true);
    const result = await getGroupsThatLikedMe();
    if (result.groups) {
      setLikedGroups(result.groups as LikedGroup[]);
    }
    setIsLoadingLikes(false);
  }, []);

  // Dynamic map import for code splitting
  useEffect(() => {
    if (viewMode === "map" && !MapComponent) {
      import("@/app/components/LikedGroupsMap")
        .then((mod) => {
          setMapComponent(() => mod.default);
        })
        .catch((err) => {
          console.error("Failed to load map component:", err);
        });
    }
  }, [viewMode, MapComponent]);

  useEffect(() => {
    loadChats();
    const pollInterval = setInterval(() => {
      loadChats();
    }, 5000);

    const channel = supabase
      .channel("realtime_messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "Message" },
        (payload) => {
          const newMessage = payload.new;
          setChats((currentChats) => {
            const chatIndex = currentChats.findIndex((c) => c.id === newMessage.chatId);
            if (chatIndex > -1) {
              const updatedChat = {
                ...currentChats[chatIndex],
                lastMessage: newMessage.text,
                time: newMessage.createdAt,
                unread: currentChats[chatIndex].unread + 1,
              };
              const newChatsList = [...currentChats];
              newChatsList.splice(chatIndex, 1);
              newChatsList.unshift(updatedChat);
              return newChatsList;
            } else {
              loadChats();
              return currentChats;
            }
          });
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [loadChats]);

  // ── Supabase Realtime + Polling for Likes ──
  useEffect(() => {
    // Polling fallback every 5s (same pattern as chats)
    const likesPollInterval = setInterval(() => {
      loadLikedGroups();
    }, 5000);

    // Supabase Realtime: listen for GroupLike INSERT and DELETE
    const likesChannel = supabase
      .channel("realtime_group_likes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "GroupLike" },
        () => {
          loadLikedGroups();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "GroupLike" },
        () => {
          loadLikedGroups();
        }
      )
      .subscribe();

    return () => {
      clearInterval(likesPollInterval);
      supabase.removeChannel(likesChannel);
    };
  }, [loadLikedGroups]);

  const loadBlockedGroups = useCallback(async () => {
    setIsLoadingBlocked(true);
    const result = await getBlockedGroupsAction();
    if (result.groups) {
      setBlockedGroups(result.groups);
    }
    setIsLoadingBlocked(false);
  }, []);

  const handleUnblock = async (blockedGroupId: string) => {
    setUnblockingId(blockedGroupId);
    const result = await unblockGroupAction(blockedGroupId);
    if (result.success) {
      setBlockedGroups((prev) => prev.filter((g) => g.blockedGroupId !== blockedGroupId));
      loadChats();
    }
    setUnblockingId(null);
  };

  useEffect(() => {
    if (activeTab === "likes") {
      loadLikedGroups();
    }
  }, [activeTab, loadLikedGroups]);

  const formatMessageTime = (dateString: string | Date) => {
    const date = new Date(dateString);
    const today = new Date();
    const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth();
    if (isToday) {
      return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString(locale, { weekday: "short" });
  };

  const filteredChats = chats.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredLikedGroups = likedGroups.filter((group) => {
    const name = group.user?.username || group.user?.name || "";
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const likesCount = likedGroups.length;

  return (
    <div className="min-h-screen bg-black text-white font-sans pb-32">
      <div className="fixed top-0 left-0 right-0 bg-black/90 backdrop-blur-md z-30 pt-12 pb-4 px-6 border-b border-white/5">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-black italic uppercase tracking-tight">{t("title")}</h1>
          <div className="relative header-menu-container">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <MoreVertical size={20} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-[#1A1A1A] border border-white/10 rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setBlockedModalOpen(true);
                    loadBlockedGroups();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                >
                  <Shield size={16} />
                  {t("blockedGroups") || "Blocked Groups"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab("chats")}
            className={`flex-1 py-2.5 rounded-full text-sm font-black uppercase tracking-wider transition-all ${
              activeTab === "chats"
                ? "bg-[#FF725E] text-black"
                : "bg-white/5 text-gray-400 hover:text-white"
            }`}
          >
            {t("tabChats") || "Chats"}
          </button>
          <button
            onClick={() => setActiveTab("likes")}
            className={`flex-1 py-2.5 rounded-full text-sm font-black uppercase tracking-wider transition-all relative ${
              activeTab === "likes"
                ? "bg-[#FF725E] text-black"
                : "bg-white/5 text-gray-400 hover:text-white"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Heart size={14} />
              {t("tabLikes") || "Likes"}
            </span>
            {likesCount > 0 && activeTab !== "likes" && (
              <span className="absolute -top-1.5 -right-1.5 bg-[#FF725E] text-black text-[9px] font-black min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
                {likesCount}
              </span>
            )}
          </button>
        </div>

        {activeTab === "likes" && filteredLikedGroups.length > 0 && (
          <div className="flex justify-end mb-2">
            <div className="flex bg-white/5 rounded-full p-0.5">
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1 ${
                  viewMode === "list"
                    ? "bg-[#FF725E] text-black"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <List size={12} />
                {t("listView") || "List"}
              </button>
              <button
                onClick={() => setViewMode("map")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1 ${
                  viewMode === "map"
                    ? "bg-[#FF725E] text-black"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <Map size={12} />
                {t("mapView") || "Map"}
              </button>
            </div>
          </div>
        )}

        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search size={18} className="text-gray-500" />
          </div>
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#111111] text-sm text-white rounded-full py-3 pl-11 pr-4 border border-white/10 focus:outline-none focus:border-[#FF725E]/50 transition-colors placeholder:text-gray-600"
          />
        </div>
      </div>

      <div className="pt-72 px-4">
        {activeTab === "chats" && (
          <>
            {isLoadingChats && (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="animate-spin text-[#FF725E]" size={30} />
              </div>
            )}

            <div className="flex flex-col gap-2">
              {!isLoadingChats &&
                filteredChats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => router.push(`/${locale}/messages/${chat.id}`)}
                    className="w-full flex items-center gap-4 p-3 rounded-2xl hover:bg-white/5 transition-colors text-left group"
                  >
                    <div className="relative shrink-0">
                      <div className="w-14 h-14 rounded-full overflow-hidden border border-white/10 relative bg-zinc-900">
                        <Image
                          src={chat.image}
                          alt={chat.name}
                          fill
                          className="object-cover"
                        />
                      </div>
                      {chat.unread > 0 && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-[#FF725E] rounded-full border-2 border-black" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 border-b border-white/5 pb-3 group-last:border-0">
                      <div className="flex justify-between items-center mb-1 pr-2">
                        <div className="flex items-center gap-2">
                          <h3
                            className={`text-base truncate ${
                              chat.unread > 0 ? "font-black text-white" : "font-bold text-gray-200"
                            }`}
                          >
                            {chat.name}
                          </h3>
                          {chat.isMatch && (
                            <span className="text-[10px] uppercase tracking-[0.18em] bg-[#FF725E]/15 text-[#FF725E] px-2 py-0.5 rounded-full font-black">
                              Match
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[10px] shrink-0 ml-2 ${
                            chat.unread > 0 ? "text-[#FF725E] font-bold" : "text-gray-500 font-medium"
                          }`}
                        >
                          {formatMessageTime(chat.time)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <p
                          className={`text-sm line-clamp-1 flex-1 pr-4 ${
                            chat.unread > 0 ? "text-white font-semibold" : "text-gray-400"
                          }`}
                        >
                          {chat.lastMessage}
                        </p>
                        {chat.unread > 0 ? (
                          <div className="bg-[#FF725E] text-black text-[10px] font-black min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center">
                            {chat.unread}
                          </div>
                        ) : (
                          <CheckCheck size={14} className="text-blue-500 shrink-0" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
            </div>

            {!isLoadingChats && chats.length === 0 && (
              <div className="flex flex-col items-center justify-center pt-20 px-10 text-center animate-in fade-in">
                <div className="w-20 h-20 bg-[#111111] rounded-full flex items-center justify-center mb-4 border border-white/5">
                  <Search size={30} className="text-[#FF725E]/50" />
                </div>
                <h2 className="text-xl font-bold mb-2 uppercase italic tracking-tight">
                  {t("emptyTitle")}
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed">{t("emptyDesc")}</p>
              </div>
            )}
          </>
        )}

        {activeTab === "likes" && (
          <>
            {isLoadingLikes && (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="animate-spin text-[#FF725E]" size={30} />
              </div>
            )}

            {!isLoadingLikes && viewMode === "map" && MapComponent && (
              <div className="rounded-2xl overflow-hidden h-[60vh] border border-white/10">
                <MapComponent groups={filteredLikedGroups} />
              </div>
            )}

            {!isLoadingLikes && viewMode === "list" && (
              <div className="flex flex-col gap-3">
                {filteredLikedGroups.map((group) => (
                  <LikedMeCard key={group.id} group={group} />
                ))}
              </div>
            )}

            {!isLoadingLikes && likedGroups.length === 0 && (
              <div className="flex flex-col items-center justify-center pt-20 px-10 text-center animate-in fade-in">
                <div className="w-20 h-20 bg-[#111111] rounded-full flex items-center justify-center mb-4 border border-white/5">
                  <Heart size={30} className="text-[#FF725E]/50" />
                </div>
                <h2 className="text-xl font-bold mb-2 uppercase italic tracking-tight">
                  {t("noLikesTitle") || "No likes yet"}
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {t("noLikesDesc") || "When other groups like your profile, they will appear here."}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {blockedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-6 mx-4 max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">
                {t("blockedGroups") || "Blocked Groups"}
              </h3>
              <button
                onClick={() => setBlockedModalOpen(false)}
                className="p-1 rounded-full hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {isLoadingBlocked ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-[#FF725E]" size={30} />
              </div>
            ) : blockedGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Shield size={36} className="text-gray-600 mb-3" />
                <p className="text-sm text-gray-400">
                  {t("noBlockedGroups") || "No blocked groups"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t("noBlockedGroupsDesc") || "Groups you block will appear here."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 overflow-y-auto flex-1">
                {blockedGroups.map((group: any) => (
                  <div
                    key={group.blockedGroupId}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/5"
                  >
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 border border-white/10 shrink-0">
                      <img
                        src={group.photos?.[0] || group.user?.image || "/images/bg-fallback.jpg"}
                        alt={group.user?.name || "Group"}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">
                        {group.user?.username || group.user?.name || "Unknown"}
                      </p>
                      <p className="text-xs text-gray-500">
                        {group.membersCount} {group.membersCount === 1 ? "Member" : "Members"} · {group.gender}
                      </p>
                    </div>
                    <button
                      onClick={() => handleUnblock(group.blockedGroupId)}
                      disabled={unblockingId === group.blockedGroupId}
                      className="px-3 py-1.5 rounded-full bg-white/10 text-xs font-bold hover:bg-white/20 transition-colors disabled:opacity-50 shrink-0"
                    >
                      {unblockingId === group.blockedGroupId ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        t("unblock") || "Unblock"
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Navigation />
    </div>
  );
}
