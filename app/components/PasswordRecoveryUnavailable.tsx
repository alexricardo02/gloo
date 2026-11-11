import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Shown on /forgotPassword and /resetPassword while EMAIL_FLOWS_ENABLED is off
 * (see lib/features.ts): password recovery needs email, which is not set up yet.
 */
export default async function PasswordRecoveryUnavailable({ locale }: { locale: string }) {
  const t = await getTranslations("EmailFlows");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <div
        data-testid="password-recovery-unavailable"
        className="w-full max-w-md bg-card border border-border rounded-[2.5rem] p-8 shadow-2xl flex flex-col items-center text-center"
      >
        <div className="w-20 h-20 bg-muted text-muted-foreground border border-border rounded-full flex items-center justify-center mb-6">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-4">{t("recoveryUnavailableTitle")}</h1>
        <p className="text-muted-foreground mb-8">{t("recoveryUnavailableDesc")}</p>
        <Link
          href={`/${locale}/login`}
          data-testid="password-recovery-back-to-login"
          className="w-full bg-accent text-on-accent rounded-full py-4 font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-accent/20"
        >
          {t("backToLogin")}
        </Link>
      </div>
    </div>
  );
}
