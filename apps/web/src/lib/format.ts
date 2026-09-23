export const inr = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const dateTime = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const ago = (iso: string | Date) => {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600_000);
  return h < 1 ? "under 1h" : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};
