"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { deleteAccountAction } from "@/app/actions/auth";
import Navigation from "@/app/components/Navigation";
import { AlertTriangle, ChevronLeft, X, Loader2 } from "lucide-react";

export default function AccountSettingsPage() {
  const locale = useLocale();
  const t = useTranslations("AccountSettings");
  
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    <div className="min-h-screen bg-black text-white font-sans pb-32">
      <div className="flex items-center justify-between gap-4 p-6 border-b border-white/10 mb-6 bg-[#111111] rounded-b-[2.5rem]">
        <Link href={`/${locale}/profile`} className="hover:text-[#FF725E] transition-colors">
          <ChevronLeft size={28} strokeWidth={3} />
        </Link>
        <h1 className="text-3xl font-extrabold text-white flex-1">
          {t("title")}
        </h1>
      </div>

      <div className="px-6 space-y-10">
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
            {t("securitySection")}
          </h2>
          
          <div className="border border-white/10 bg-[#141414] rounded-3xl p-6 space-y-4">
            <div>
              <h3 className="font-black text-lg text-white mb-2">
                {t("passwordTitle")}
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                {t("passwordDesc")}
              </p>
              <button className="font-bold text-sm bg-[#1A1A1A] text-white border border-white/10 px-6 py-3 rounded-full hover:bg-white/5 transition-colors">
                {t("changePasswordButton")}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
            {t("dataPrivacySection")}
          </h2>
          
          <div className="border border-white/10 bg-[#141414] rounded-3xl p-6 space-y-4">
            <div>
              <h3 className="font-black text-lg text-white mb-2">
                {t("dataDownloadTitle")}
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                {t("dataDownloadDesc")}
              </p>
              <button className="font-bold text-sm bg-[#1A1A1A] text-white border border-white/10 px-6 py-3 rounded-full hover:bg-white/5 transition-colors">
                {t("downloadDataButton")}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-red-600">
            {t("dangerZone")}
          </h2>
          
          <div className="border-2 border-red-600/30 bg-red-600/5 rounded-3xl p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-600/10 rounded-lg text-red-600 flex-shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-black text-lg text-white mb-2">
                  {t("deleteAccountTitle")}
                </h3>
                <p className="text-sm text-gray-400 mb-6">
                  {t("deleteAccountDesc")}
                </p>
                <button
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="font-bold text-sm bg-red-600 text-white px-6 py-3 rounded-full hover:bg-red-700 transition-colors"
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

          <div className="relative bg-[#111111] border border-red-600/30 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">
            <button
              onClick={() => !isDeleting && setIsDeleteModalOpen(false)}
              className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors disabled:opacity-50"
              disabled={isDeleting}
            >
              <X size={24} />
            </button>

            <div className="flex items-center justify-center mb-6">
              <div className="p-4 bg-red-600/10 rounded-full text-red-600">
                <AlertTriangle size={32} />
              </div>
            </div>

            <h3 className="text-2xl font-black text-center italic uppercase mb-4 tracking-tight text-white">
              {t("confirmDeleteTitle")}
            </h3>

            <p className="text-sm text-gray-400 text-center mb-2">
              {t("confirmDeleteMsg1")}
            </p>

            <ul className="space-y-2 mb-6 text-sm text-gray-400">
              <li className="flex items-center gap-2">
                <span className="text-red-600">•</span>
                {t("confirmDeleteItem1")}
              </li>
              <li className="flex items-center gap-2">
                <span className="text-red-600">•</span>
                {t("confirmDeleteItem2")}
              </li>
              <li className="flex items-center gap-2">
                <span className="text-red-600">•</span>
                {t("confirmDeleteItem3")}
              </li>
              <li className="flex items-center gap-2">
                <span className="text-red-600">•</span>
                {t("confirmDeleteItem4")}
              </li>
            </ul>

            <p className="text-sm font-bold text-red-600 text-center mb-6">
              {t("confirmDeleteMsg2")}
            </p>

            {deleteError && (
              <div className="mb-6 p-4 bg-red-600/10 border border-red-600/30 rounded-lg">
                <p className="text-sm text-red-400">{deleteError}</p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="w-full font-black py-4 rounded-full uppercase tracking-widest text-sm bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isDeleting && <Loader2 size={18} className="animate-spin" />}
                {isDeleting ? t("deleting") : t("confirmDeleteButton")}
              </button>

              <button
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="w-full font-bold py-3 rounded-full uppercase tracking-widest text-sm text-gray-400 border border-white/10 bg-[#1A1A1A] hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
