import { Shell } from "@/components/Shell";
import { api, type Me } from "@/lib/server-api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Me>("/auth/me");
  return <Shell user={{ name: me.name, roleLabel: me.roleLabel, modules: me.modules }}>{children}</Shell>;
}
