"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { verifyAccountAction } from "@/app/actions/verify";

export default function VerifyPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const t = useTranslations("Verify");
  const locale = useLocale();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleVerify() {
    if (!token) {
      setError(t("noToken"));
      return;
    }
    setLoading(true);
    const result = await verifyAccountAction(token, locale);

    if (result?.error) {
      setError(t("invalidToken"));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 shadow-xl flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mb-6">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-4">{t("title")}</h2>
        <p className="text-gray-600 mb-8">
          {t("subtitle")}
        </p>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-6 w-full text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={loading || !token}
          className="w-full bg-[#FF725E] text-white rounded-full py-4 font-semibold hover:bg-[#ff5f49] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t("verifying") : t("button")}
        </button>
      </div>
    </div>
  );
}