"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { deleteAccountAction, getCurrentUser, requestPasswordReset } from "@/app/actions/auth";
import Navigation from "@/app/components/Navigation";
import { AlertTriangle, ChevronLeft, X, Loader2, CheckCircle } from "lucide-react";

export default function AccountSettingsPage() {
  const locale = useLocale();
  const t = useTranslations("AccountSettings");

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetPasswordSent, setResetPasswordSent] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      const user = await getCurrentUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    };
    loadUser();
  }, []);

  const handleChangePassword = async () => {
    if (!userEmail) return;
    setIsResettingPassword(true);
    try {
      await requestPasswordReset(userEmail, locale);
      setResetPasswordSent(true);
    } catch {
      // Silently handle – requestPasswordReset always returns success
      setResetPasswordSent(true);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const result = await deleteAccountAction(locale);

      if (result?.error) {
        setDeleteError(result.error);
        setIsDeleting(false);
      }
    } catch (error) {
      console.error("Error deleting account:", error);
      setDeleteError("An unexpected error occurred. Please try again.");
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans pb-32">
      <div className="flex items-center justify-between gap-4 p-6 border-b border-border mb-6 bg-card rounded-b-[2.5rem]">
        <Link
          href={`/${locale}/profile`}
          aria-label="Back to profile"
          className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-muted text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft size={24} strokeWidth={2.5} />
        </Link>
        <h1 className="text-2xl font-black uppercase tracking-tight text-foreground flex-1">
          {t("title")}
        </h1>
      </div>

      <div className="px-6 space-y-8">
        <div className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
            {t("securitySection")}
          </h2>

          <div className="border border-border bg-card rounded-3xl p-6 space-y-4 shadow-sm">
            <div>
              <h3 className="font-black text-lg text-foreground mb-2">
                {t("passwordTitle")}
              </h3>
              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                {t("passwordDesc")}
              </p>

              {!resetPasswordSent ? (
                <button
                  onClick={handleChangePassword}
                  disabled={isResettingPassword}
                  className="min-h-[44px] font-bold text-xs uppercase tracking-wider bg-card text-foreground border border-border px-6 py-3 rounded-full hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {isResettingPassword && <Loader2 size={16} className="animate-spin text-primary" />}
                  {isResettingPassword ? t("sending") || "Sending…" : t("changePasswordButton")}
                </button>
              ) : (
                <div className="flex items-start gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl">
                  <CheckCircle size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-green-400">
                      {t("resetLinkSentTitle") || "Reset link sent!"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("resetLinkSentDesc") || "Check your email for the password reset link."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-destructive">
            {t("dangerZone")}
          </h2>

          <div className="border-2 border-destructive/30 bg-destructive/5 rounded-3xl p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-destructive/10 rounded-2xl text-destructive flex-shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-black text-lg text-foreground mb-2">
                  {t("deleteAccountTitle")}
                </h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  {t("deleteAccountDesc")}
                </p>
                <button
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="min-h-[44px] font-black text-xs uppercase tracking-wider bg-destructive text-white px-6 py-3 rounded-full hover:opacity-90 transition-opacity cursor-pointer flex items-center justify-center"
                >
                  {t("deleteAccountButton")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => !isDeleting && setIsDeleteModalOpen(false)}
          />

          <div className="relative bg-card border border-destructive/30 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">
            <button
              onClick={() => !isDeleting && setIsDeleteModalOpen(false)}
              aria-label="Close"
              className="w-11 h-11 rounded-full flex items-center justify-center absolute top-5 right-5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer"
              disabled={isDeleting}
            >
              <X size={20} />
            </button>

            <div className="flex items-center justify-center mb-6">
              <div className="p-4 bg-destructive/10 rounded-full text-destructive">
                <AlertTriangle size={32} />
              </div>
            </div>

            <h3 className="text-xl font-black text-center uppercase mb-3 tracking-tight text-foreground">
              {t("confirmDeleteTitle")}
            </h3>

            <p className="text-sm text-muted-foreground text-center mb-4 leading-relaxed">
              {t("confirmDeleteMsg1")}
            </p>

            <ul className="space-y-2 mb-6 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="text-destructive font-black">•</span>
                {t("confirmDeleteItem1")}
              </li>
              <li className="flex items-center gap-2">
                <span className="text-destructive font-black">•</span>
                {t("confirmDeleteItem2")}
              </li>
              <li className="flex items-center gap-2">
                <span className="text-destructive font-black">•</span>
                {t("confirmDeleteItem3")}
              </li>
              <li className="flex items-center gap-2">
                <span className="text-destructive font-black">•</span>
                {t("confirmDeleteItem4")}
              </li>
            </ul>

            <p className="text-xs font-bold text-destructive text-center mb-6">
              {t("confirmDeleteMsg2")}
            </p>

            {deleteError && (
              <div className="mb-6 p-3 bg-destructive/10 border border-destructive/30 rounded-2xl">
                <p className="text-xs text-destructive text-center">{deleteError}</p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="w-full min-h-[48px] font-black py-3.5 rounded-full uppercase tracking-wider text-xs bg-destructive text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {isDeleting && <Loader2 size={16} className="animate-spin" />}
                {isDeleting ? t("deleting") : t("confirmDeleteButton")}
              </button>

              <button
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="w-full min-h-[48px] font-bold py-3.5 rounded-full uppercase tracking-wider text-xs text-muted-foreground border border-border bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {t("cancelButton")}
              </button>
            </div>
          </div>
        </div>
      )}

      <Navigation />
    </div>
  );
}
