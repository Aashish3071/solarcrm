import { notFound } from "next/navigation";
import { ALL_NAV } from "@/lib/nav";
import { api, type Me } from "@/lib/server-api";

/** Placeholder for modules scheduled after Phase 0, so navigation and permissions can be reviewed now. */
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = ALL_NAV.find((i) => i.href === `/${section}`);
  if (!item) notFound();
  const me = await api<Me>("/auth/me");
  if (!me.modules.includes(item.module)) notFound();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{item.label}</h1>
          <p>Source: {item.source}</p>
        </div>
      </div>
      <p className="notice">This module is built in {item.phase}. The workflow rules it relies on are already enforced by the API.</p>
    </>
  );
}
