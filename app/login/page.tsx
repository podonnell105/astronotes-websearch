import { AppShell } from "@/components/AppShell";
import { LoginForm } from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return (
    <AppShell>
      <div className="flex flex-1 items-center justify-center px-6">
        <LoginForm />
      </div>
    </AppShell>
  );
}
