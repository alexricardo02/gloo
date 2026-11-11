import { connection } from "next/server";
import { isEmailFlowEnabled } from "@/lib/features";
import PasswordRecoveryUnavailable from "@/app/components/PasswordRecoveryUnavailable";
import ResetPasswordForm from "./ResetPasswordForm";

export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  // Render per request so the server-side flag is read at runtime, not at build.
  await connection();
  if (!isEmailFlowEnabled()) {
    const { locale } = await params;
    return <PasswordRecoveryUnavailable locale={locale} />;
  }
  return <ResetPasswordForm />;
}
