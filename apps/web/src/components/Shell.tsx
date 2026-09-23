"use client";

import { LogOut, Menu, Sparkles, Sun, X } from "lucide-react";
import { AdvisorPanel } from "./AdvisorPanel";
import { Bell } from "./Bell";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ADMIN_NAV, ALL_NAV, WORK_NAV, type NavItem } from "@/lib/nav";

interface ShellUser {
  name: string;
  roleLabel: string;
  modules: string[];
}

export function Shell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);

  const allowed = (items: NavItem[]) => items.filter((i) => user.modules.includes(i.module));
  const work = allowed(WORK_NAV);
  const admin = allowed(ADMIN_NAV);
  const active = ALL_NAV.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    if (!aiOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAiOpen(false);
        fabRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const link = (i: NavItem) => {
    const Icon = i.icon;
    return (
      <Link key={i.href} href={i.href} aria-current={active?.href === i.href ? "page" : undefined}>
        <Icon aria-hidden="true" />
        {i.label}
      </Link>
    );
  };

  return (
    <div className="shell">
      <a className="skip" href="#content">Skip to content</a>
      <aside className={`side${navOpen ? " open" : ""}`} aria-label="Primary">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Sun size={20} strokeWidth={2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">SolarCRM</div>
            <div className="brand-sub">Solar Operations &amp; Projects</div>
          </div>
          <span className="brand-dot" title="Connected" aria-label="Connected" />
        </div>
        <nav className="nav" aria-label="Main">
          {work.map(link)}
          {admin.length > 0 && (
            <>
              <div className="nav-label">Administration</div>
              {admin.map(link)}
            </>
          )}
        </nav>
        <div className="me">
          <div className="avatar" aria-hidden="true">{user.name.charAt(0)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="me-name">{user.name.split(" ")[0]}</div>
            <div className="me-role">{user.roleLabel}</div>
          </div>
          <div className="me-actions">
            <Bell />
            <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="work">
        <header className="topbar">
          <div className="crumbs">
            <button className="icon-btn menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="Open navigation" aria-expanded={navOpen}>
              <Menu aria-hidden="true" />
            </button>
            <span>{active?.label ?? "SolarCRM"}</span>
            <span aria-hidden="true">/</span>
            <span>Overview</span>
          </div>
          <div className="top-actions">
            <form role="search" action="/projects" style={{ display: "contents" }}>
              <input className="search" type="search" name="q" placeholder="Search name, phone or project code" aria-label="Search projects" />
            </form>
            <button className="btn" type="button" disabled title="User guide arrives in Phase 5">? Guide</button>
          </div>
        </header>
        <main className="content" id="content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <button
        ref={fabRef}
        className="fab"
        aria-label="Open AI Advisor"
        aria-expanded={aiOpen}
        aria-controls="ai-advisor"
        onClick={() => setAiOpen((v) => !v)}
      >
        <Sparkles aria-hidden="true" />
      </button>
      {aiOpen && (
        <section className="drawer" id="ai-advisor" role="dialog" aria-label="AI Advisor">
          <header>
            <h2>AI Advisor</h2>
            <button className="icon-btn" onClick={() => { setAiOpen(false); fabRef.current?.focus(); }} aria-label="Close AI Advisor">
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="body">
            <AdvisorPanel />
          </div>
        </section>
      )}
    </div>
  );
}
