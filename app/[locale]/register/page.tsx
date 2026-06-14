"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import SocialLinks from "@/app/components/SocialLinks";
import { registerUser, checkUsernameAvailability } from "@/app/actions/auth";

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations("Register");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const locale = useLocale();
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [isSuccess, setIsSuccess] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [dob, setDob] = useState("");

  const [isDobFocused, setIsDobFocused] = useState(false);

  const [username, setUsername] = useState("");

  const [isUsernameAvailable, setIsUsernameAvailable] = useState<boolean | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);

  const [password, setPassword] = useState("");
  const [pwdCriteria, setPwdCriteria] = useState({
    length: false,
    uppercase: false,
    number: false,
    special: false
  });


  useEffect(() => {
    const savedData = sessionStorage.getItem("gloo_register_data");
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.name) setName(parsed.name);
        if (parsed.email) setEmail(parsed.email);
        if (parsed.dob) setDob(parsed.dob);
        if (parsed.username) setUsername(parsed.username);
        if (parsed.password) {
          setPassword(parsed.password);
          setPwdCriteria({
            length: parsed.password.length >= 8,
            uppercase: /[A-Z]/.test(parsed.password),
            number: /\d/.test(parsed.password),
            special: /[@$!%*?&.]/.test(parsed.password)
          });
        }
        if (parsed.agreed) setAgreed(parsed.agreed);
      } catch (e) {
        console.error("Error parsing saved registration data:", e);
      }
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem("gloo_register_data", JSON.stringify({
      name, email, dob, username, password, agreed
    }));
  }, [name, email, dob, username, password, agreed]);

  useEffect(() => {
    if (username.trim().length < 3) {
      setIsUsernameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingUsername(true);
      const result = await checkUsernameAvailability(username.trim());
      setIsUsernameAvailable(result.available);
      setIsCheckingUsername(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [username]);

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPassword(val);
    
    setPwdCriteria({
      length: val.length >= 8,
      uppercase: /[A-Z]/.test(val),
      number: /\d/.test(val),
      special: /[@$!%*?&.]/.test(val)
    });
  };


  async function handleSubmit(formData: FormData) {
    const result = await registerUser(formData, locale);
    if (result?.error) {
      setError(result.error);
    } else if (result?.success && result?.needsVerification) {
      sessionStorage.removeItem("gloo_register_data");
      setIsSuccess(true);
    }
  }

  const today = new Date();
  const maxDate = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate())
    .toISOString()
    .split('T')[0]; 
    
  const isPasswordStrong = pwdCriteria.length && pwdCriteria.uppercase && pwdCriteria.number && pwdCriteria.special;
  const canSubmit = agreed && isPasswordStrong && (isUsernameAvailable === true) && username.length >= 3 && dob;

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 shadow-xl flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Check your email</h2>
          <p className="text-gray-600 mb-8">{t("successCheckEmail")}</p>
          <Link href={`/${locale}/login`} className="w-full bg-[#FF725E] text-white rounded-full py-4 font-semibold hover:bg-[#ff5f49] transition-colors">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans py-12">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] px-8 pb-8 pt-6 shadow-xl flex flex-col">
        
        <div className="flex items-center mb-6">
          <button 
            onClick={() => {
              sessionStorage.removeItem("gloo_register_data");
              router.push(`/${locale}/login`);
            }} 
            className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors text-gray-600"
            aria-label="Go to Dashboard"
          > 
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
        </div>
        
        <div className="mb-8 relative z-0">
          <h1 className="text-3xl font-extrabold text-black mb-2">{t('title')}</h1>
          <p className="text-sm text-gray-600">
            {t('alreadyHaveAccount')}
            <Link 
              href={`/${locale}/login`} 
              onClick={() => sessionStorage.removeItem("gloo_register_data")}
              className="text-black font-bold hover:underline ml-1"
            >
              {t('signIn')}
            </Link>
          </p>
        </div>

        {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl w-full text-sm text-center font-medium mb-6">
              {t(error)}
            </div>
          )}

        <form action={handleSubmit} className="flex flex-col gap-4">
          
          <div className="flex gap-4">
            <div className="relative flex items-center bg-[#F7F7F7] rounded-2xl px-4 py-4 focus-within:ring-2 focus-within:ring-black/20 transition-all w-full">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-500 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
              <input 
                name="name"
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                required
                className="bg-transparent outline-none w-full ml-3 text-gray-800 placeholder-gray-400 font-medium"
              />
            </div>
          </div>

          <div className="relative flex items-center bg-[#F7F7F7] rounded-2xl px-4 py-4 focus-within:ring-2 focus-within:ring-black/20 transition-all w-full overflow-hidden">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-500 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>

            {!dob && !isDobFocused && (
              <span className="absolute left-[3.25rem] text-gray-400 font-medium pointer-events-none">
                {t('dobPlaceholder')}
              </span>
            )}

            <input
              type="date"
              name="birthDate"
              required
              max={maxDate}
              value={dob}
              onFocus={() => setIsDobFocused(true)}
              onBlur={() => setIsDobFocused(false)}
              onChange={(e) => setDob(e.target.value)}
              className={`bg-transparent outline-none w-full ml-3 font-medium cursor-pointer relative z-10 
                ${(dob || isDobFocused) ? 'text-gray-800' : 'text-transparent'} 
                [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
            />
          </div>

          <div className="relative flex items-center bg-[#F7F7F7] rounded-2xl px-4 py-4 focus-within:ring-2 focus-within:ring-black/20 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-500 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
            <input
              name="email" 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder={t('emailPlaceholder')}
              required
              className="bg-transparent outline-none w-full ml-3 text-gray-800 placeholder-gray-400 font-medium"
            />
          </div>

          <div className="flex flex-col w-full gap-1">
            <div className={`relative flex items-center bg-[#F7F7F7] rounded-2xl px-4 py-4 focus-within:ring-2 transition-all w-full ${isUsernameAvailable === false ? 'ring-2 ring-red-500/50' : isUsernameAvailable === true ? 'ring-2 ring-green-500/50' : 'focus-within:ring-black/20'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-500 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
              <input 
                name="username"
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
                placeholder={t('usernamePlaceholder')}
                required
                className="bg-transparent outline-none w-full ml-2 text-gray-800 placeholder-gray-400 font-medium pr-8"
              />
              
              
              <div className="absolute right-4 flex items-center justify-center">
                {isCheckingUsername && (
                  <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                )}
                {!isCheckingUsername && isUsernameAvailable === true && (
                  <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                )}
                {!isCheckingUsername && isUsernameAvailable === false && (
                  <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                )}
              </div>
            </div>
            
            <div className="ml-3 h-4">
              {!isCheckingUsername && isUsernameAvailable === false && username.length >= 3 && (
                <span className="text-[11px] text-red-500 font-bold">{t('usernameTakenError')}</span>
              )}
              {!isCheckingUsername && isUsernameAvailable === true && username.length >= 3 && (
                <span className="text-[11px] text-green-600 font-bold">{t('usernameAvailable')}</span>
              )}
              {username.length > 0 && username.length < 3 && (
                <span className="text-[11px] text-gray-400 font-medium">{t('usernameTooShort')}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col w-full gap-1">
            <div className={`relative flex items-center bg-[#F7F7F7] rounded-2xl px-4 py-4 focus-within:ring-2 transition-all ${password.length > 0 && isPasswordStrong ? 'ring-2 ring-green-500/50' : 'focus-within:ring-black/20'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-500 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <input 
                name="password"
                type={showPassword ? "text" : "password"} 
                value={password}
                onChange={handlePasswordChange}
                placeholder={t('passwordPlaceholder')}
                required
                className="bg-transparent outline-none w-full ml-3 text-gray-800 placeholder-gray-400 font-medium pr-8"
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 text-gray-400 hover:text-gray-600 focus:outline-none"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>

            {password.length > 0 && (
              <div className="flex flex-col gap-1.5 px-3 mt-1">
                <div className="flex gap-2">
                  <div className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${pwdCriteria.length ? 'bg-green-500' : 'bg-gray-200'}`}></div>
                  <div className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${pwdCriteria.uppercase ? 'bg-green-500' : 'bg-gray-200'}`}></div>
                  <div className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${pwdCriteria.number ? 'bg-green-500' : 'bg-gray-200'}`}></div>
                  <div className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${pwdCriteria.special ? 'bg-green-500' : 'bg-gray-200'}`}></div>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-400 font-semibold mt-1">
                  <span className={`transition-colors duration-300 ${pwdCriteria.length ? "text-green-600" : ""}`}>
                    {pwdCriteria.length ? "✓" : "○"} {t('pwdMinChars')}
                  </span>
                  <span className={`transition-colors duration-300 ${pwdCriteria.uppercase ? "text-green-600" : ""}`}>
                    {pwdCriteria.uppercase ? "✓" : "○"} {t('pwdUppercase')}
                  </span>
                  <span className={`transition-colors duration-300 ${pwdCriteria.number ? "text-green-600" : ""}`}>
                    {pwdCriteria.number ? "✓" : "○"} {t('pwdNumber')}
                  </span>
                  <span className={`transition-colors duration-300 ${pwdCriteria.special ? "text-green-600" : ""}`}>
                    {pwdCriteria.special ? "✓" : "○"} {t('pwdSpecial')}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-start gap-3 mt-2">
            <input 
              type="checkbox" 
              id="terms" 
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-gray-300 text-black accent-black focus:ring-black cursor-pointer"
            />
            <label htmlFor="terms" className="text-sm text-gray-600 font-medium leading-tight cursor-pointer">
              {t('agreePrefix')}<Link href="/termsOfService" className="text-black font-bold hover:underline">{t('termsOfService')}</Link> {t('and')} <Link href="/privacyPolicy" className="text-black font-bold hover:underline">{t('privacyPolicy')}</Link>.
            </label>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={!agreed}
              className={`w-full font-black py-4 rounded-full text-sm uppercase tracking-widest transition-all ${
                agreed
                  ? "bg-[#FF725E] text-black hover:scale-[1.01] active:scale-[0.99] shadow-xl shadow-[#FF725E]/10 cursor-pointer"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed opacity-70"
              }`}
            >
              {t("createAccountButton")}
            </button>
          </div>
        </form>

        <div className="flex items-center my-6">
          <hr className="flex-grow border-gray-200" />
          <span className="px-4 text-gray-400 text-sm">{t('orSignUpWith')}</span>
          <hr className="flex-grow border-gray-200" />
        </div>

        <div className="flex justify-center gap-4">
          <button className="w-14 h-14 bg-[#F7F7F7] rounded-2xl flex items-center justify-center hover:bg-gray-200 transition-colors">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          </button>
          <button className="w-14 h-14 bg-[#F7F7F7] rounded-2xl flex items-center justify-center hover:bg-gray-200 transition-colors">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="black" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.126 3.822 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.665-1.48 3.666-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2.025-.156-4.013 1.09-4.63 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702z"/>
            </svg>
          </button>
        </div>
        
        <div className="mt-6">
          <SocialLinks variant="light" />
        </div>
      </div>
    </div>
  );
}