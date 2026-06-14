"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  const router = useRouter();
  const t = useTranslations("Privacy");

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">

      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10 flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-lg font-black uppercase tracking-tight">
          {t("title")}
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight mb-2">{t("title")}</h2>
          <p className="text-xs font-bold text-[#FF725E] uppercase tracking-widest">
            {t("lastUpdated")}
          </p>
        </div>

        <p className="text-gray-600 leading-relaxed font-medium">
          {t("intro")}
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-black uppercase tracking-tight">{t("section1Title")}</h3>
          <p className="text-gray-600 leading-relaxed font-medium">
            {t("section1Content")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-black uppercase tracking-tight">{t("section2Title")}</h3>
          <p className="text-gray-600 leading-relaxed font-medium">
            {t("section2Content")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-black uppercase tracking-tight">{t("section3Title")}</h3>
          <p className="text-gray-600 leading-relaxed font-medium">
            {t("section3Content")}
          </p>
        </section>
      </div>

    </div>
  );
}