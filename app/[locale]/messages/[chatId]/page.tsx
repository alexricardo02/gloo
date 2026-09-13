"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Send, CheckCheck, Loader2, AlertCircle, MoreVertical, Shield, Flag, X } from "lucide-react";
import { getChatMessages, sendMessage } from "@/app/actions/chat";
import { blockGroupAction, reportGroupAction } from "@/app/actions/moderation";
import { supabase } from "@/lib/supabase";

type MessageWithSender = {
  id: string;
  text: string;
  senderId: string;
  createdAt: string | Date;
  sender: { id: string; name: string; image: string | null };
};

type Partner = {
  id: string;
  name: string;
  image: string;
};

export default function ChatDetailPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Chat");
  const { chatId } = useParams<{ chatId: string }>();

  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [partner, setPartner] = useState<Partner | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"error" | "success">("error");

  // ST0-88: Dropdown menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isReporting, setIsReporting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // ── Load initial data ──
  useEffect(() => {
    async function init() {
      const result = await getChatMessages(chatId);
      if (result.error) {
        setError(result.error);
        setIsLoading(false);
        return;
      }
      if (result.success && result.messages && result.partner) {
        setMessages(result.messages as MessageWithSender[]);
        setUserId(result.userId || "");
        setPartner(result.partner as Partner);
        setTimeout(scrollToBottom, 100);
      }
      setIsLoading(false);
    }
    init();
  }, [chatId, scrollToBottom]);

  // ── Supabase real-time subscription (ST0-72) ──
  useEffect(() => {
    const channel = supabase
      .channel(`chat_${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "Message",
          filter: `chatId=eq.${chatId}`,
        },
        (payload) => {
          const msg = payload.new as { id: string; text: string; senderId: string; chatId: string; createdAt: string };
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg as unknown as MessageWithSender];
          });
          setTimeout(scrollToBottom, 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, scrollToBottom]);

  // ST0-101: Real-time listener for blocks – redirect if the chat gets blocked
  useEffect(() => {
    const blockChannel = supabase
      .channel(`block_${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "GroupBlock",
        },
        async () => {
          // Re-check if this conversation is now blocked
          const result = await getChatMessages(chatId);
          if (result.error) {
            setError(result.error);
            setTimeout(() => {
              router.push(`/${locale}/messages`);
            }, 2000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(blockChannel);
    };
  }, [chatId, locale, router]);

  // ── Polling fallback: refetch messages every 3s so recipient sees them
  //     even if Supabase Realtime isn't delivering postgres_changes events
  useEffect(() => {
    const interval = setInterval(async () => {
      const result = await getChatMessages(chatId);
      if (result.success && result.messages) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = (result.messages as MessageWithSender[]).filter(
            (m) => !existingIds.has(m.id)
          );
          if (newMsgs.length === 0) return prev;
          return [...prev, ...newMsgs];
        });
      } else if (result.error) {
        setError(result.error);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [chatId]);

  // ── Auto-focus input on load ──
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  // ── Auto scroll on new messages ──
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Close dropdown on outside click ──
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // ── Send message handler (ST0-71) ──
  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;
    const textToSend = newMessage;
    setIsSending(true);
    setError(null);
    setNewMessage("");

    const result = await sendMessage(chatId, textToSend);
    if (result.error) {
      setError(result.error);
      setNewMessage(textToSend);
    } else if (result.message) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === result.message.id)) return prev;
        return [...prev, result.message as unknown as MessageWithSender];
      });
      inputRef.current?.focus();
    }
    setIsSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ST0-88: Block group handler
  const handleBlock = async () => {
    setIsBlocking(true);
    setShowBlockConfirm(false);
    const result = await blockGroupAction(chatId);
    if (result.error) {
      setError(result.error);
    } else {
      router.push(`/${locale}/messages`);
    }
    setIsBlocking(false);
  };

  // ST0-88: Report group handler
  const handleReport = async () => {
    setIsReporting(true);
    setMenuOpen(false);
    const result = await reportGroupAction(chatId);
    if (result.error) {
      setError(result.error);
      setToastType("error");
    } else {
      setError(t("groupReported") || "Report sent");
      setToastType("success");
    }
    setIsReporting(false);
  };

  const formatTime = (dateStr: string | Date) => {
    return new Date(dateStr).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ── Loading state ──
  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  // ── Fatal error state ──
  if (error && !partner) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8 text-center">
        <AlertCircle size={40} className="text-destructive mb-4" />
        <p className="text-foreground font-bold mb-4">{error}</p>
        <button
          onClick={() => router.push(`/${locale}/messages`)}
          className="min-h-[44px] px-6 py-3 bg-card border border-border rounded-full text-sm font-bold text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          {t("backToMessages") || "Back to Messages"}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <div className="fixed top-0 left-0 right-0 bg-background/90 backdrop-blur-md z-30 pt-12 pb-3 px-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/${locale}/messages`)}
            className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-muted text-foreground transition-colors shrink-0 cursor-pointer"
            aria-label="Back"
          >
            <ArrowLeft size={22} />
          </button>
          {partner && (
            <>
              <div className="w-10 h-10 rounded-full overflow-hidden bg-muted border border-border shrink-0">
                <img
                  src={partner.image}
                  alt={partner.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <h2 className="text-base font-bold truncate flex-1 text-foreground">{partner.name}</h2>
            </>
          )}

          {/* ST0-88: Dropdown menu — Block / Report */}
          {partner && (
            <div className="relative shrink-0" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                data-testid="chat-options-btn"
                className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-muted text-foreground transition-colors cursor-pointer"
                aria-label="More options"
              >
                <MoreVertical size={20} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowBlockConfirm(true);
                    }}
                    data-testid="block-group-btn"
                    className="w-full min-h-[44px] flex items-center gap-3 px-4 py-3 text-sm text-destructive hover:bg-muted transition-colors cursor-pointer text-left"
                  >
                    <Shield size={18} />
                    {t("blockGroup") || "Block Group"}
                  </button>
                  <button
                    onClick={handleReport}
                    data-testid="report-group-btn"
                    disabled={isReporting}
                    className="w-full min-h-[44px] flex items-center gap-3 px-4 py-3 text-sm text-amber-500 hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer text-left"
                  >
                    {isReporting ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Flag size={18} />
                    )}
                    {t("reportGroup") || "Report"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ST0-88: Block confirm dialog */}
      {showBlockConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl p-6 mx-4 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black uppercase tracking-tight text-foreground">
                {t("confirmBlockTitle") || "Block Group?"}
              </h3>
              <button
                onClick={() => setShowBlockConfirm(false)}
                aria-label="Close"
                className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              {t("confirmBlockDesc") || "Are you sure? This will hide the chat and prevent further contact."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowBlockConfirm(false)}
                className="flex-1 min-h-[44px] py-2.5 rounded-full border border-border bg-card text-sm font-bold text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                {t("cancel") || "Cancel"}
              </button>
              <button
                onClick={handleBlock}
                data-testid="block-confirm-btn"
                disabled={isBlocking}
                className="flex-1 min-h-[44px] py-2.5 rounded-full bg-destructive text-white text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isBlocking ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Shield size={16} />
                )}
                {t("blockConfirm") || "Block"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 pt-24 pb-28 px-4 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full min-h-[200px]">
            <p className="text-muted-foreground text-sm">
              {t("emptyChat") || "No messages yet. Say hello!"}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2.5 max-w-lg mx-auto">
          {messages.map((msg) => {
            const isOwn = msg.senderId === userId;
            return (
              <div
                key={msg.id}
                className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[78%] px-4 py-3 rounded-2xl ${
                    isOwn
                      ? "bg-primary text-on-primary font-medium rounded-br-sm shadow-sm"
                      : "bg-card text-foreground border border-border rounded-bl-sm shadow-sm"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                  <div
                    className={`flex items-center gap-1 mt-1 ${
                      isOwn ? "justify-end" : "justify-start"
                    }`}
                  >
                    <span
                      className={`text-[10px] ${
                        isOwn ? "text-black/70 font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      {formatTime(msg.createdAt)}
                    </span>
                    {isOwn && (
                      <CheckCheck size={14} className="text-black/70" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Error toast (ST0-73) ── */}
      {error && (
        <div className="fixed bottom-24 left-4 right-4 z-40 flex justify-center pointer-events-none">
          <div className={`px-4 py-2.5 rounded-full text-sm font-medium flex items-center gap-2 animate-in slide-in-from-bottom-2 shadow-lg ${
            toastType === "success"
              ? "bg-amber-500 text-black font-bold"
              : "bg-destructive text-white"
          }`}>
            <AlertCircle size={16} />
            {error}
          </div>
        </div>
      )}

      {/* ── Input bar (ST0-70: send button disabled when empty) ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-md border-t border-border px-4 py-3 z-30 safe-bottom">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <input
            ref={inputRef}
            type="text"
            data-testid="chat-message-input"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("typeMessage") || "Type a message..."}
            disabled={isSending}
            className="flex-1 min-h-[48px] bg-card text-foreground text-sm rounded-full px-5 py-3 border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            data-testid="chat-send-btn"
            disabled={!newMessage.trim() || isSending}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer ${
              newMessage.trim() && !isSending
                ? "bg-primary text-on-primary shadow-[0_0_15px_rgba(255,114,94,0.4)] hover:scale-105 active:scale-95"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
            }`}
            aria-label="Send"
          >
            {isSending ? (
              <Loader2 size={20} className="animate-spin text-on-primary" />
            ) : (
              <Send size={20} className={newMessage.trim() ? "text-on-primary" : "text-muted-foreground"} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
