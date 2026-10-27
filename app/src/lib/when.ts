// "today 12:04", "yesterday", "3 days ago", then a date (GitHub tab lists).
import { formatTime } from './files';
import { t } from './i18n';

const pad = (n: number) => String(n).padStart(2, '0');

export function relativeTime(ms: number, now = Date.now()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const then = new Date(ms);
  const days = Math.round((day(new Date(now)) - day(then)) / 86_400_000);
  if (days <= 0) {
    return t('time.today', { time: `${pad(then.getHours())}:${pad(then.getMinutes())}` });
  }
  if (days === 1) {
    return t('time.yesterday');
  }
  if (days < 7) {
    return t('time.days_ago', { count: days });
  }
  return formatTime(ms, now);
}
