import { connection } from "next/server";
import { isEmailFlowEnabled } from "@/lib/features";
import AccountSettings from "./AccountSettings";

export default async function AccountSettingsPage() {
  // Render per request so the server-side flag is read at runtime, not at build.
  await connection();
  return <AccountSettings emailFlowsEnabled={isEmailFlowEnabled()} />;
}
