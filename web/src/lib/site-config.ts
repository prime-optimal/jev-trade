import raw from "@/site.config.json";

export const ICON_KINDS = ["github", "x", "discord", "telegram", "youtube", "link"] as const;
export type IconKind = (typeof ICON_KINDS)[number];

export interface SiteLink {
  label: string;
  href: string;
}

export interface SiteIcon extends SiteLink {
  kind: IconKind;
}

export interface SiteConfig {
  name: string;
  slogan: string;
  /** Path under web/public or an https URL. null uses the built-in mark. */
  logo: string | null;
  menu: SiteLink[];
  icons: SiteIcon[];
}

const MAX_TEXT = 80;
const MAX_ITEMS = 8;

function text(value: unknown, field: string, max = MAX_TEXT, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  if (/[·–—]/.test(trimmed)) throw new Error(`${field} cannot contain middle dots, en dashes, or em dashes`);
  return trimmed;
}

/** Internal paths start with one "/"; external links must be https. */
function href(value: unknown, field: string, internalOk: boolean): string {
  const v = text(value, field, 300);
  if (internalOk && v.startsWith("/") && !v.startsWith("//")) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new Error(`${field} must be ${internalOk ? "a path starting with / or " : ""}an https URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${field} must use https`);
  return url.toString();
}

function list<T>(value: unknown, field: string, item: (v: Record<string, unknown>, i: number) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be a list`);
  if (value.length > MAX_ITEMS) throw new Error(`${field} can have at most ${MAX_ITEMS} items`);
  return value.map((v, i) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${field} ${i + 1} must be an object`);
    return item(v as Record<string, unknown>, i);
  });
}

function unique<T extends SiteLink>(items: T[], field: string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.href)) throw new Error(`${field} URLs must be unique: ${item.href}`);
    seen.add(item.href);
  }
  return items;
}

export function validateSiteConfig(input: unknown): SiteConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Site config must be an object");
  const c = input as Record<string, unknown>;
  const logo = c.logo === null || c.logo === undefined || c.logo === "" ? null : href(c.logo, "Logo", true);
  return {
    name: text(c.name, "Site name", 40),
    slogan: text(c.slogan, "Slogan", MAX_TEXT, true),
    logo,
    menu: unique(list(c.menu, "Menu item", (v, i) => ({
      label: text(v.label, `Menu item ${i + 1} label`, 24),
      href: href(v.href, `Menu item ${i + 1} URL`, true),
    })), "Menu item"),
    icons: unique(list(c.icons, "Icon link", (v, i) => {
      if (!ICON_KINDS.includes(v.kind as IconKind)) throw new Error(`Icon link ${i + 1} kind must be one of ${ICON_KINDS.join(", ")}`);
      return {
        kind: v.kind as IconKind,
        label: text(v.label, `Icon link ${i + 1} label`, 60),
        href: href(v.href, `Icon link ${i + 1} URL`, false),
      };
    }), "Icon link"),
  };
}

export const siteConfig: SiteConfig = validateSiteConfig(raw);
