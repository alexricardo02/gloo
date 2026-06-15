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
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-[#FF725E]" size={30} />
      </div>
    );
  }

  // ── Fatal error state ──
  if (error && !partner) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-8 text-center">
        <AlertCircle size={40} className="text-red-400 mb-4" />
        <p className="text-white font-bold mb-4">{error}</p>
        <button
          onClick={() => router.push(`/${locale}/messages`)}
          className="px-6 py-3 bg-white/10 rounded-full text-sm font-bold hover:bg-white/20 transition-colors"
        >
          {t("backToMessages") || "Back to Messages"}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col">
      <div className="fixed top-0 left-0 right-0 bg-black/90 backdrop-blur-md z-30 pt-12 pb-3 px-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/${locale}/messages`)}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={22} />
          </button>
          {partner && (
            <>
              <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-800 border border-white/10 shrink-0">
                <img
                  src={partner.image}
                  alt={partner.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <h2 className="text-base font-bold truncate flex-1">{partner.name}</h2>
            </>
          )}

          {/* ST0-88: Dropdown menu — Block / Report */}
          {partner && (
            <div className="relative shrink-0" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                data-testid="chat-options-btn"
                className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
                aria-label="More options"
              >
                <MoreVertical size={20} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-[#1A1A1A] border border-white/10 rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowBlockConfirm(true);
                    }}
                    data-testid="block-group-btn"
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-white/5 transition-colors"
                  >
                    <Shield size={16} />
                    {t("blockGroup") || "Block Group"}
                  </button>
                  <button
                    onClick={handleReport}
                    data-testid="report-group-btn"
                    disabled={isReporting}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-yellow-400 hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    {isReporting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Flag size={16} />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">
                {t("confirmBlockTitle") || "Block Group?"}
              </h3>
              <button
                onClick={() => setShowBlockConfirm(false)}
                className="p-1 rounded-full hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-6">
              {t("confirmBlockDesc") || "Are you sure? This will hide the chat and prevent further contact."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowBlockConfirm(false)}
                className="flex-1 py-2.5 rounded-full border border-white/10 text-sm font-bold hover:bg-white/5 transition-colors"
              >
                {t("cancel") || "Cancel"}
              </button>
              <button
                onClick={handleBlock}
                data-testid="block-confirm-btn"
                disabled={isBlocking}
                className="flex-1 py-2.5 rounded-full bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isBlocking ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Shield size={14} />
                )}
                {t("blockConfirm") || "Block"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 pt-24 pb-24 px-4 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">
              {t("emptyChat") || "No messages yet. Say hello!"}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2 max-w-lg mx-auto">
          {messages.map((msg) => {
            const isOwn = msg.senderId === userId;
            return (
              <div
                key={msg.id}
                className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2.5 rounded-2xl ${
                    isOwn
                      ? "bg-[#FF725E] text-black rounded-br-md"
                      : "bg-[#1A1A1A] text-white rounded-bl-md"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                  <div
                    className={`flex items-center gap-1 mt-0.5 ${
                      isOwn ? "justify-end" : "justify-start"
                    }`}
                  >
                    <span
                      className={`text-[10px] ${
                        isOwn ? "text-black/60" : "text-gray-500"
                      }`}
                    >
                      {formatTime(msg.createdAt)}
                    </span>
                    {isOwn && (
                      <CheckCheck size={12} className="text-black/60" />
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
          <div className={`px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 animate-in slide-in-from-bottom-2 shadow-lg ${
            toastType === "success"
              ? "bg-yellow-500/90 text-black"
              : "bg-red-500/90 text-white"
          }`}>
            <AlertCircle size={14} />
            {error}
          </div>
        </div>
      )}

      {/* ── Input bar (ST0-70: send button disabled when empty) ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-white/10 px-4 py-3 z-30">
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
            className="flex-1 bg-[#1A1A1A] text-white text-sm rounded-full px-5 py-3 border border-white/10 focus:outline-none focus:border-[#FF725E]/50 transition-colors placeholder:text-gray-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            data-testid="chat-send-btn"
            disabled={!newMessage.trim() || isSending}
            className={`p-3 rounded-full transition-all shrink-0 ${
              newMessage.trim() && !isSending
                ? "bg-[#FF725E] text-black shadow-[0_0_15px_rgba(255,114,94,0.3)] hover:scale-105 active:scale-95"
                : "bg-[#1A1A1A] text-gray-600 cursor-not-allowed"
            }`}
            aria-label="Send"
          >
            {isSending ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
