import path from "node:path";
const nextConfig = {
  devIndicators: false,
  webpack(config) {
    config.resolve.alias["@/lib/supabase/server$"] = path.resolve(process.cwd(), "lib/supabase-server.js");
    config.resolve.alias["@"] = path.resolve(process.cwd(), "../../..");
    return config;
  },
  async rewrites() { return [{ source: "/:locale/book/:slug", destination: "/" }]; },
};
export default nextConfig;
