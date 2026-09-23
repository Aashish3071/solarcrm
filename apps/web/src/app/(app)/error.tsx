"use client";

/** Shown when a page cannot load its data, e.g. the API is unreachable. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card" role="alert" style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>This page could not load</h1>
      <p style={{ margin: "0 0 16px", color: "var(--mute)" }}>The server did not respond. Check your connection and try again.</p>
      <button className="btn primary" onClick={reset}>Try again</button>
    </div>
  );
}
