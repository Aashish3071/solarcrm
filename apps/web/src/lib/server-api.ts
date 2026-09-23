import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Server-side call to the API, forwarding the user's session cookie. Redirects to login on 401. */
export async function api<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_URL}/api${path}`, { headers: { cookie: cookieHeader }, cache: "no-store" });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  modules: string[];
}
