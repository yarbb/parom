import { describe, expect, it } from 'vitest';
import { availableLocales, resolveLocale, setLocale, t } from './i18n';

describe('Russian', () => {
  it('picks the plural form for the number', () => {
    setLocale('ru');
    expect(t('github.comments', { count: 1 })).toBe('1 комментарий');
    expect(t('github.comments', { count: 3 })).toBe('3 комментария');
    expect(t('github.comments', { count: 5 })).toBe('5 комментариев');
    expect(t('github.comments', { count: 21 })).toBe('21 комментарий');
    setLocale('en');
    expect(t('github.comments', { count: 5 })).toBe('5 comments');
  });

  it('covers every English message', () => {
    expect(availableLocales().find((l) => l.code === 'ru')?.coverage).toBe(100);
  });

  it('falls back to English for an unknown language', () => {
    expect(resolveLocale('xx')).toBe('en');
    expect(resolveLocale('ru')).toBe('ru');
  });
});
