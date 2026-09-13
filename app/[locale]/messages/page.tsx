"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Navigation from "@/app/components/Navigation";
import LikedMeCard from "@/app/components/LikedMeCard";
import PageHeader from "@/app/components/PageHeader";
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

  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);

  const [likedGroups, setLikedGroups] = useState<LikedGroup[]>([]);
  const [isLoadingLikes, setIsLoadingLikes] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

  const [MapComponent, setMapComponent] = useState<any>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [blockedModalOpen, setBlockedModalOpen] = useState(false);
  const [blockedGroups, setBlockedGroups] = useState<any[]>([]);
  const [isLoadingBlocked, setIsLoadingBlocked] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

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

  const loadChats = useCallback(async () => {
    const response = await getActiveChats();
    if (response.success && response.chats) {
      setChats(response.chats as ChatPreview[]);
    }
    setIsLoadingChats(false);
  }, []);

  const loadLikedGroups = useCallback(async () => {
    setIsLoadingLikes(true);
    const result = await getGroupsThatLikedMe();
    if (result.groups) {
      setLikedGroups(result.groups as LikedGroup[]);
    }
    setIsLoadingLikes(false);
  }, []);

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

  useEffect(() => {
    const likesPollInterval = setInterval(() => {
      loadLikedGroups();
    }, 5000);

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
    <div className="min-h-screen bg-background text-foreground font-sans pb-32">
      <PageHeader
        title={t("title")}
        actions={
          <div className="relative header-menu-container">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Options"
              className="w-11 h-11 rounded-full bg-card border border-border flex items-center justify-center hover:bg-muted text-foreground transition-colors cursor-pointer"
            >
              <MoreVertical size={20} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setBlockedModalOpen(true);
                    loadBlockedGroups();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-foreground hover:bg-muted transition-colors cursor-pointer text-left"
                >
                  <Shield size={18} className="text-primary" />
                  {t("blockedGroups") || "Blocked Groups"}
                </button>
              </div>
            )}
          </div>
        }
      >
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab("chats")}
            data-testid="messages-tab-chats"
            className={`flex-1 min-h-[44px] py-2.5 rounded-full text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${activeTab === "chats"
                ? "bg-primary text-on-primary shadow-sm"
                : "bg-card text-muted-foreground border border-border hover:text-foreground hover:bg-muted"
              }`}
          >
            {t("tabChats") || "Chats"}
          </button>
          <button
            onClick={() => setActiveTab("likes")}
            data-testid="messages-tab-likes"
            className={`flex-1 min-h-[44px] py-2.5 rounded-full text-xs font-black uppercase tracking-wider transition-all relative cursor-pointer ${activeTab === "likes"
                ? "bg-primary text-on-primary shadow-sm"
                : "bg-card text-muted-foreground border border-border hover:text-foreground hover:bg-muted"
              }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Heart size={14} />
              {t("tabLikes") || "Likes"}
            </span>
            {likesCount > 0 && activeTab !== "likes" && (
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-on-primary text-[10px] font-black min-w-[20px] h-5 rounded-full flex items-center justify-center px-1 border-2 border-background">
                {likesCount}
              </span>
            )}
          </button>
        </div>

        {activeTab === "likes" && filteredLikedGroups.length > 0 && (
          <div className="flex justify-end mb-3">
            <div className="flex bg-card rounded-full p-1 border border-border">
              <button
                onClick={() => setViewMode("list")}
                className={`px-3.5 py-1.5 min-h-[36px] rounded-full text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === "list"
                    ? "bg-primary text-on-primary font-black"
                    : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <List size={14} />
                {t("listView") || "List"}
              </button>
              <button
                onClick={() => setViewMode("map")}
                className={`px-3.5 py-1.5 min-h-[36px] rounded-full text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === "map"
                    ? "bg-primary text-on-primary font-black"
                    : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <Map size={14} />
                {t("mapView") || "Map"}
              </button>
            </div>
          </div>
        )}

        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search size={18} className="text-muted-foreground" />
          </div>
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[48px] bg-card text-sm text-foreground rounded-full py-3 pl-11 pr-4 border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground"
          />
        </div>
      </PageHeader>

      <div className={`px-4 ${activeTab === "likes" && filteredLikedGroups.length > 0 ? "pt-72" : "pt-64"}`}>
        {activeTab === "chats" && (
          <>
            {isLoadingChats && (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            )}

            <div className="flex flex-col gap-2">
              {!isLoadingChats &&
                filteredChats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => router.push(`/${locale}/messages/${chat.id}`)}
                    className="w-full min-h-[72px] flex items-center gap-4 p-3 rounded-2xl hover:bg-muted/40 transition-colors text-left group cursor-pointer"
                  >
                    <div className="relative shrink-0">
                      <div className="w-14 h-14 rounded-full overflow-hidden border border-border relative bg-muted">
                        <Image
                          src={chat.image}
                          alt={chat.name}
                          fill
                          className="object-cover"
                        />
                      </div>
                      {chat.unread > 0 && (
                        <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-primary text-on-primary rounded-full border-2 border-background text-[10px] font-black flex items-center justify-center" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 border-b border-border/50 pb-3 group-last:border-0">
                      <div className="flex justify-between items-center mb-1 pr-2">
                        <div className="flex items-center gap-2">
                          <h3
                            className={`text-base truncate ${chat.unread > 0 ? "font-black text-foreground" : "font-bold text-foreground/90"
                              }`}
                          >
                            {chat.name}
                          </h3>
                          {chat.isMatch && (
                            <span className="text-[10px] uppercase tracking-[0.18em] bg-primary/15 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-black">
                              Match
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-xs shrink-0 ml-2 ${chat.unread > 0 ? "text-primary font-black" : "text-muted-foreground font-medium"
                            }`}
                        >
                          {formatMessageTime(chat.time)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <p
                          className={`text-sm line-clamp-1 flex-1 pr-4 ${chat.unread > 0 ? "text-foreground font-medium" : "text-muted-foreground"
                            }`}
                        >
                          {chat.lastMessage}
                        </p>
                        {chat.unread > 0 ? (
                          <div className="bg-primary text-on-primary text-[10px] font-black min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center">
                            {chat.unread}
                          </div>
                        ) : (
                          <CheckCheck size={16} className="text-muted-foreground shrink-0" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
            </div>

            {!isLoadingChats && chats.length === 0 && (
              <div className="flex flex-col items-center justify-center pt-20 px-10 text-center animate-in fade-in">
                <div className="w-20 h-20 bg-card rounded-full flex items-center justify-center mb-4 border border-border">
                  <Search size={30} className="text-primary/70" />
                </div>
                <h2 className="text-xl font-black mb-2 uppercase tracking-tight text-foreground">
                  {t("emptyTitle")}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px]">{t("emptyDesc")}</p>
              </div>
            )}
          </>
        )}

        {activeTab === "likes" && (
          <>
            {isLoadingLikes && (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            )}

            {!isLoadingLikes && viewMode === "map" && MapComponent && (
              <div className="rounded-3xl overflow-hidden h-[60vh] border border-border">
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
                <div className="w-20 h-20 bg-card rounded-full flex items-center justify-center mb-4 border border-border">
                  <Heart size={30} className="text-primary/70" />
                </div>
                <h2 className="text-xl font-black mb-2 uppercase tracking-tight text-foreground">
                  {t("noLikesTitle") || "No likes yet"}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px]">
                  {t("noLikesDesc") || "When other groups like your profile, they will appear here."}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {blockedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl p-6 mx-4 max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black uppercase tracking-tight text-foreground">
                {t("blockedGroups") || "Blocked Groups"}
              </h3>
              <button
                onClick={() => setBlockedModalOpen(false)}
                aria-label="Close"
                className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {isLoadingBlocked ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            ) : blockedGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Shield size={36} className="text-muted-foreground mb-3" />
                <p className="text-sm text-foreground font-semibold">
                  {t("noBlockedGroups") || "No blocked groups"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("noBlockedGroupsDesc") || "Groups you block will appear here."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 overflow-y-auto flex-1">
                {blockedGroups.map((group: any) => (
                  <div
                    key={group.blockedGroupId}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-muted/40 border border-border"
                  >
                    <div className="w-11 h-11 rounded-full overflow-hidden bg-muted border border-border shrink-0">
                      <img
                        src={group.photos?.[0] || group.user?.image || "/images/bg-fallback.jpg"}
                        alt={group.user?.name || "Group"}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate text-foreground">
                        {group.user?.username || group.user?.name || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.membersCount} {group.membersCount === 1 ? "Member" : "Members"} · {group.gender}
                      </p>
                    </div>
                    <button
                      onClick={() => handleUnblock(group.blockedGroupId)}
                      disabled={unblockingId === group.blockedGroupId}
                      className="min-h-[44px] px-4 py-2 rounded-full bg-card border border-border text-xs font-bold text-foreground hover:bg-muted transition-colors disabled:opacity-50 shrink-0 cursor-pointer flex items-center justify-center"
                    >
                      {unblockingId === group.blockedGroupId ? (
                        <Loader2 size={16} className="animate-spin" />
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
