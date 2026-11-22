import type { NextConfig } from "next";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";

const config: NextConfig = {
  transpilePackages: ["@atlas/design-system", "@atlas/auth"],
  // the API is proxied under /api so session cookies stay first-party (SameSite=Lax, HttpOnly)
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/connect.sh",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=60" },
        ],
      },
      {
        source: "/connect.ps1",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=60" },
        ],
      },
      {
        source: "/atlas-social-connect.tgz",
        headers: [
          { key: "Cache-Control", value: "public, max-age=60" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  poweredByHeader: false,
};
export default config;
