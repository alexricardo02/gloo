"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, AlertCircle, CheckCircle, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { resetPassword } from "@/app/actions/auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const t = useTranslations("ResetPassword");

  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isValidating, setIsValidating] = useState(true);

  useEffect(() => {
    if (!token) {
      setError("tokenMissing");
    }
    setIsValidating(false);
  }, [token]);

  const validatePassword = () => {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*?&.]{8,}$/;
    return passwordRegex.test(password);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("tokenMissing");
      return;
    }

    if (password !== confirmPassword) {
      setError("passwordMismatch");
      return;
    }

    if (!validatePassword()) {
      setError("passwordWeakError");
      return;
    }

    setIsLoading(true);

    try {
      const result = await resetPassword(token, password);
      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error || "An error occurred");
      }
    } catch (err) {
      console.error("Error:", err);
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-sans py-12">
        <div className="w-full max-w-md bg-white rounded-[2.5rem] px-8 pb-8 pt-6 shadow-[0_10px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[#FF725E]" />
        </div>
      </div>
    );
  }

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

        {!success && !error ? (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-black uppercase tracking-tight text-gray-900 mb-3">
                {t('title')}
              </h1>
              <p className="text-sm text-gray-500 font-medium leading-relaxed">
                {t('description')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  {t('passwordLabel')}
                </label>
                <div className="relative flex items-center bg-gray-50 border border-gray-200 rounded-2xl px-4 py-4 focus-within:border-[#FF725E] transition-all">
                  <Lock className="w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('passwordPlaceholder')}
                    required
                    className="bg-transparent outline-none w-full ml-3 text-sm font-medium text-gray-900 placeholder-gray-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  {t('confirmPasswordLabel')}
                </label>
                <div className="relative flex items-center bg-gray-50 border border-gray-200 rounded-2xl px-4 py-4 focus-within:border-[#FF725E] transition-all">
                  <Lock className="w-5 h-5 text-gray-400" />
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('confirmPasswordPlaceholder')}
                    required
                    className="bg-transparent outline-none w-full ml-3 text-sm font-medium text-gray-900 placeholder-gray-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-500 bg-gray-50 rounded-2xl p-4">
                <p className="font-bold mb-2">{t('passwordRequirements')}:</p>
                <ul className="space-y-1">
                  <li className={password.length >= 8 ? "text-green-600" : ""}>✓ {t('req1')}</li>
                  <li className={/[A-Z]/.test(password) ? "text-green-600" : ""}>✓ {t('req2')}</li>
                  <li className={/[a-z]/.test(password) ? "text-green-600" : ""}>✓ {t('req3')}</li>
                  <li className={/[0-9]/.test(password) ? "text-green-600" : ""}>✓ {t('req4')}</li>
                  <li className={/[@$!%*?&.]/.test(password) ? "text-green-600" : ""}>✓ {t('req5')}</li>
                </ul>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading || !password || !confirmPassword}
                  className="w-full bg-[#FF725E] text-black font-black py-4 rounded-full text-sm uppercase tracking-widest hover:scale-[1.01] active:scale-[0.99] transition-all shadow-xl shadow-[#FF725E]/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isLoading ? t('resetting') : t('resetButton')}
                </button>
              </div>
            </form>
          </>
        ) : error && !success ? (
          <>
            <div className="flex flex-col items-center text-center py-8">
              <div className="mb-6 p-4 bg-red-100 rounded-full">
                <AlertCircle className="w-12 h-12 text-red-600" />
              </div>

              <h2 className="text-2xl font-black uppercase tracking-tight text-gray-900 mb-4">
                {t('errorTitle')}
              </h2>

              <p className="text-sm text-gray-600 mb-8">
                {t(error)}
              </p>

              <button
                onClick={() => router.push(`/${locale}/forgotPassword`)}
                className="w-full bg-[#FF725E] text-black font-black py-4 rounded-full text-sm uppercase tracking-widest hover:scale-[1.01] active:scale-[0.99] transition-all shadow-xl shadow-[#FF725E]/10"
              >
                {t('requestNewLink')}
              </button>
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

              <p className="text-sm text-gray-600 mb-8">
                {t('successMessage')}
              </p>

              <button
                onClick={() => router.push(`/${locale}/login`)}
                className="w-full bg-[#FF725E] text-black font-black py-4 rounded-full text-sm uppercase tracking-widest hover:scale-[1.01] active:scale-[0.99] transition-all shadow-xl shadow-[#FF725E]/10"
              >
                {t('goToLogin')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
