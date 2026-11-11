import { connection } from "next/server";
import { redirect } from "next/navigation";
import { isEmailFlowEnabled } from "@/lib/features";
import { getOptionalUserId } from "@/lib/session";
import VerifyForm from "./VerifyForm";

export default async function VerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  // Render per request so the server-side flag is read at runtime, not at build.
  await connection();
  if (!isEmailFlowEnabled()) {
    // Nothing to verify while email flows are off: send signed-in users to the
    // discovery feed (where a login lands) and everyone else to login.
    const { locale } = await params;
    const userId = await getOptionalUserId();
    redirect(userId ? `/${locale}/search-groups` : `/${locale}/login`);
  }
  return <VerifyForm />;
}
