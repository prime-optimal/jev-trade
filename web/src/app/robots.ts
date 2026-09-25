import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://jevon.up.railway.app/sitemap.xml",
    host: "https://jevon.up.railway.app",
  };
}
