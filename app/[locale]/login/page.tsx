"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import SocialLinks from "@/app/components/SocialLinks";
import { useState } from "react";
import { loginUser } from "@/app/actions/auth";

export default function LoginPage() {
  const t = useTranslations("Login");
  const router = useRouter();
  const locale = useLocale();

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(formData: FormData) {
    setError("");
    const result = await loginUser(formData, locale);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 shadow-xl flex flex-col">
        <div className="flex items-center mb-6">
          <button
            onClick={() => router.push(`/${locale}/search-groups`)}
            className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors text-gray-600"
            aria-label="Go back"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
          </button>
        </div>

        <div className="mt-4 mb-8">
          <h1 className="text-3xl font-extrabold text-black mb-2">
            {t("title")}
          </h1>
          <p className="text-sm text-gray-600">
            {t("newUser")}{" "}
            <Link
              href="/register"
              className="text-black font-bold hover:underline"
            >
              {t("createAccount")}
            </Link>
          </p>
        </div>

        {error && (
          <p data-testid="login-error-msg" className="text-red-500 text-sm text-center font-medium mb-4">
            {t(error)}
          </p>
        )}

        <form action={handleSubmit} className="flex flex-col gap-4" data-testid="login-form">
          <div className="relative flex items-center bg-[#F7F7F7] rounded-2xl px-4 py-4 focus-within:ring-2 focus-within:ring-black/20 transition-all">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6 text-gray-500"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
              />
            </svg>
            <input
              name="identifier"
              type="text"
              data-testid="login-identifier-input"
              placeholder={t("emailOrUsernamePlaceholder")}
              required
              className="bg-transparent outline-none w-full ml-3 text-gray-800 placeholder-gray-400 font-medium"
            />
          </div>

          <div className="relative flex items-center bg-[#F7F7F7] rounded-2xl px-4 py-4 focus-within:ring-2 focus-within:ring-black/20 transition-all">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6 text-gray-500"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              data-testid="login-password-input"
              placeholder={t("passwordPlaceholder")}
              required
              className="bg-transparent outline-none w-full ml-3 text-gray-800 placeholder-gray-400 font-medium"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-gray-400 hover:text-gray-600 focus:outline-none"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                />
              </svg>
            </button>
          </div>

          <div className="flex justify-start">
            <Link
              href="/forgotPassword"
              className="text-sm font-bold text-gray-800 hover:underline"
            >
              {t("forgotPassword")}
            </Link>
          </div>

          <button
            type="submit"
            data-testid="login-submit-btn"
            className="w-full bg-black text-white font-bold py-4 rounded-full mt-4 hover:bg-gray-800 transition-colors active:scale-95 transform"
          >
            {t("loginButton")}
          </button>
        </form>

        <div className="flex items-center my-8">
          <hr className="flex-grow border-gray-200" />
          <span className="px-4 text-gray-400 text-sm">{t("or")}</span>
          <hr className="flex-grow border-gray-200" />
        </div>

        <div className="text-center">
          <p className="text-xs font-bold text-gray-800 mb-6">
            {t("socialJoin")}
          </p>
          <div className="flex justify-center gap-4">
            <button className="w-14 h-14 bg-[#F7F7F7] rounded-2xl flex items-center justify-center hover:bg-gray-200 transition-colors">
              <svg
                className="w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            </button>
            <button className="w-14 h-14 bg-[#F7F7F7] rounded-2xl flex items-center justify-center hover:bg-gray-200 transition-colors">
              <svg
                className="w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
                  fill="#1877F2"
                />
              </svg>
            </button>
            <button className="w-14 h-14 bg-[#F7F7F7] rounded-2xl flex items-center justify-center hover:bg-gray-200 transition-colors">
              <svg
                className="w-6 h-6"
                viewBox="0 0 24 24"
                fill="black"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.126 3.822 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.665-1.48 3.666-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2.025-.156-4.013 1.09-4.63 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702z" />
              </svg>
            </button>
          </div>

          <div className="mt-6">
            <SocialLinks variant="light" />
          </div>
        </div>

        <div className="mt-16 text-center">
          <p className="text-xs text-gray-500 font-medium">
            {t("termsPrefix")} <br />
            <Link href="#" className="text-gray-800 font-bold hover:underline">
              {t("termsOfService")}
            </Link>{" "}
            {t("and")}{" "}
            <Link href="#" className="text-gray-800 font-bold hover:underline">
              {t("privacyPolicy")}
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
