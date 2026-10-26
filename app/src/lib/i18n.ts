// Minimal message lookup until the full i18n loader (M2): English only,
// `{name}` placeholders and ICU `{count, plural, one {...} other {...}}`.
import en from '../../../locales/en.json';

type Messages = Record<string, unknown>;
type Params = Record<string, string | number>;

const messages: Messages = en;
const locale = 'en';

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
