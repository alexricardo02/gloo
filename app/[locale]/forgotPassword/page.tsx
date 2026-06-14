"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, AlertCircle, CheckCircle, Mail, Loader2 } from "lucide-react";
import { useState } from "react";
import { requestPasswordReset } from "@/app/actions/auth";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("ForgotPassword");

  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await requestPasswordReset(email, locale);
      if (result.success) {
        setSubmitted(true);
        setEmail("");
      } else {
        setError((result as any).error || "An error occurred");
      }
    } catch (err) {
      console.error("Error:", err);
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-sans py-12">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] px-8 pb-8 pt-6 shadow-[0_10px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col relative">
        
        <div className="flex items-center mb-6">
          <button 
            onClick={() => router.push(`/${locale}/login`)} 
            className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-900"
            aria-label="Back to Login"
          >
            <ArrowLeft size={24} />
          </button>
        </div>

        {!submitted ? (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-black uppercase tracking-tight text-gray-900 mb-3">
                {t('title')}
              </h1>
              <p className="text-sm text-gray-500 font-medium leading-relaxed">
                {t('description')}
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-red-700 font-medium">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              
              <div className="space-y-1.5">
                <input
                  name="email" 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#FF725E] transition-all"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading || !email}
                  className="w-full bg-[#FF725E] text-black font-black py-4 rounded-full text-sm uppercase tracking-widest hover:scale-[1.01] active:scale-[0.99] transition-all shadow-xl shadow-[#FF725E]/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isLoading ? t('sending') : t('submitButton')}
                </button>
              </div>
            </form>

            <div className="mt-8 text-center">
              <Link href={`/${locale}/login`} className="text-xs font-bold text-gray-400 hover:text-gray-900 uppercase tracking-wider transition-colors">
                {t('backToLogin')}
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center text-center py-8">
              <div className="mb-6 p-4 bg-green-100 rounded-full">
                <CheckCircle className="w-12 h-12 text-green-600" />
              </div>

              <h2 className="text-2xl font-black uppercase tracking-tight text-gray-900 mb-4">
                {t('successTitle')}
              </h2>

              <p className="text-sm text-gray-600 mb-4">
                {t('successMessage')}
              </p>

              <p className="text-xs text-gray-500 bg-gray-50 rounded-2xl p-4 mb-8">
                {t('checkSpam')}
              </p>

              <button
                onClick={() => router.push(`/${locale}/login`)}
                className="w-full bg-[#FF725E] text-black font-black py-4 rounded-full text-sm uppercase tracking-widest hover:scale-[1.01] active:scale-[0.99] transition-all shadow-xl shadow-[#FF725E]/10"
              >
                {t('backToLogin')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}