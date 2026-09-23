export const inr = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const dateTime = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const ago = (iso: string | Date) => {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600_000);
  return h < 1 ? "under 1h" : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

export const day = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function remaining(ms: number) {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600_000);
  const text = h >= 48 ? `${Math.floor(h / 24)}d` : h >= 1 ? `${h}h ${Math.floor((abs % 3600_000) / 60_000)}m` : `${Math.max(1, Math.floor(abs / 60_000))}m`;
  return ms < 0 ? `${text} over` : `${text} left`;
}

