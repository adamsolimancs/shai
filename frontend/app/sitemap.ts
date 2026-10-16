import type { MetadataRoute } from "next";

const SITE_URL = "https://shaistats.vercel.app";
const PUBLIC_ROUTES = ["", "/players", "/teams", "/scores", "/news"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((path) => ({
    url: `${SITE_URL}${path || "/"}`,
    changeFrequency: path === "" ? "daily" : "hourly",
    priority: path === "" ? 1 : 0.8,
  }));
}
