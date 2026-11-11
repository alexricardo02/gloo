import { connection } from "next/server";
import { isEmailFlowEnabled } from "@/lib/features";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  // Render per request so the server-side flag is read at runtime, not at build.
  await connection();
  return <LoginForm showForgotPassword={isEmailFlowEnabled()} />;
}
