import { SettingsEditor } from "@/components/SettingsEditor";
import { api } from "@/lib/server-api";

interface ConfigList {
  params: { key: string; value: unknown; description: string | null; updatedAt: string }[];
  overrides: { key: string; userId: string; value: unknown }[];
  perUserKeys: string[];
}

/** FR-043: rules and masters as data. Every change is audited with its old and new value. */
export default async function SettingsPage() {
  const [cfg, users] = await Promise.all([api<ConfigList>("/config"), api<{ id: string; name: string; role: string }[]>("/users")]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings &amp; Data</h1>
          <p>Business rules and master lists. Changes apply to new calculations; completed incentives keep the rules they were calculated with.</p>
        </div>
      </div>
      <SettingsEditor params={cfg.params} overrides={cfg.overrides} perUserKeys={cfg.perUserKeys} users={users} />
    </>
  );
}
