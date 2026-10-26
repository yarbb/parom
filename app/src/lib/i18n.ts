// Message lookup: every locales/*.json is bundled; missing keys fall back to
// English. Values use `{name}` placeholders and ICU
// `{count, plural, one {...} few {...} other {...}}` with the locale's rules.
const bundled = import.meta.glob<Record<string, unknown>>('../../../locales/*.json', { eager: true, import: 'default' });

type Messages = Record<string, unknown>;
type Params = Record<string, string | number>;

const catalogs = new Map<string, Messages>();
for (const [file, messages] of Object.entries(bundled)) {
  const code = /([\w-]+)\.json$/.exec(file)?.[1];
  if (code) {
    catalogs.set(code, messages);
  }
}

const english: Messages = catalogs.get('en') ?? {};
let locale = 'en';
let messages: Messages = english;

export interface LocaleInfo {
  code: string;
  /** The language's own name, from _meta.name. */
  name: string;
  /** Share of English keys translated, 0..100. */
  coverage: number;
}

const keysOf = (m: Messages) => Object.keys(m).filter((k) => k !== '_meta');

export function availableLocales(): LocaleInfo[] {
  const total = keysOf(english).length || 1;
  return [...catalogs.entries()]
    .map(([code, m]) => ({
      code,
      name: String((m._meta as { name?: string } | undefined)?.name ?? code),
      coverage: Math.round((keysOf(m).filter((k) => typeof m[k] === 'string' && k in english).length / total) * 100),
    }))
    .sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.name.localeCompare(b.name)));
}

/** Switches the language for messages formatted from now on. */
export function setLocale(code: string): void {
  const found = catalogs.get(code);
  locale = found ? code : 'en';
  messages = found ? { ...english, ...found } : english;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export function currentLocale(): string {
  return locale;
}

function formatPlural(body: string, value: number): string {
  // body: "one {# file} other {# files}"
  const forms = new Map<string, string>();
  const re = /(=?\w+)\s*\{([^{}]*)\}/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    forms.set(m[1], m[2]);
  }
  const exact = forms.get(`=${value}`);
  const form = exact ?? forms.get(new Intl.PluralRules(locale).select(value)) ?? forms.get('other') ?? '';
  return form.replace(/#/g, new Intl.NumberFormat(locale).format(value));
}

export function format(template: string, params: Params = {}): string {
  return template
    .replace(/\{(\w+),\s*plural,\s*((?:[^{}]|\{[^{}]*\})*)\}/g, (_, key: string, body: string) =>
      formatPlural(body, Number(params[key] ?? 0)),
    )
    .replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}

export function t(key: string, params: Params = {}): string {
  const value = messages[key];
  return typeof value === 'string' ? format(value, params) : key;
}
