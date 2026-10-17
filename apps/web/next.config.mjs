const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Baseline headers for every page. Scripts are not restricted by CSP yet because
  // Next injects inline bootstrap scripts; nonce-based CSP is a go-live follow-up.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(), microphone=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
        ],
      },
    ];
  },
  // Proxy API calls so the session cookie stays same-origin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
