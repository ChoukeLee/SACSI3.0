import { LoginForm } from "@/components/login-form";
import { confirmationReturnPath } from "@/lib/confirmation-return-path";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm errorCode={params.error} returnPath={confirmationReturnPath(params.redirect) ?? undefined} />;
}
