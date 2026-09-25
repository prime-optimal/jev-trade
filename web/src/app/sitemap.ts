import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://jevon.up.railway.app/",
      lastModified: new Date(),
    },
  ];
}
