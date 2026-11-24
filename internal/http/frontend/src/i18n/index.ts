// SPDX-License-Identifier: AGPL-3.0-or-later
// DMRHub - Run a DMR network server in a single binary
// Copyright (C) 2023-2026 Jacob McSwain
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
//
// The source code is available at <https://github.com/USA-RedDragon/DMRHub>

import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code'];

const STORAGE_KEY = 'locale';

function isLocaleCode(value: string | null): value is LocaleCode {
  return value === 'en' || value === 'zh-CN';
}

function detectLocale(): LocaleCode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isLocaleCode(saved)) {
    return saved;
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

const initialLocale: LocaleCode = detectLocale();

// Set it before the first paint, so the browser picks the right glyphs and fonts.
document.documentElement.lang = initialLocale;

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: {
    en,
    'zh-CN': zhCN,
  },
});

export function setLocale(locale: LocaleCode): void {
  i18n.global.locale.value = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
}

/** Translate a key outside of a component setup() (e.g. Options API methods). */
export function t(key: string, named?: Record<string, unknown>): string {
  return i18n.global.t(key, named ?? {}) as string;
}

/**
 * The messages of a locale, without the compiler of the templates. The
 * messages of the backend are plain sentences, and a sentence may hold a
 * character that the compiler reads as a template, for example the "@" of an
 * email address.
 */
function messagesOf(locale: string): Record<string, unknown> {
  const messages = i18n.global.messages.value as Record<string, Record<string, unknown>>;
  return messages[locale] ?? messages.en ?? {};
}

/**
 * The message of the locale for a key, or the message of the fallback locale
 * when the locale has none. Undefined when no locale has the key.
 */
function message(key: string): string | undefined {
  const value = messagesOf(i18n.global.locale.value)[key];
  if (typeof value === 'string') return value;
  const fallback = messagesOf('en')[key];
  return typeof fallback === 'string' ? fallback : undefined;
}

/**
 * The longest key of the locale that the text starts with, for a message of
 * the backend that puts a value at its end, for example
 * "Another user has the callsign BH8GLN". Empty when there is none.
 *
 * Only a key that ends with a space matches, so that what follows is a value
 * and not another word of the message. A key with a placeholder in it is no
 * use here, because the value that follows is not what it fills in.
 */
function prefixKey(text: string): string {
  const messages = messagesOf(i18n.global.locale.value);
  let best = '';
  for (const key of Object.keys(messages)) {
    if (!key.endsWith(' ') || key.includes('{')) continue;
    if (key.length > best.length && text.startsWith(key)) best = key;
  }
  return best;
}

/**
 * Translate a message of the backend. The backend writes its errors in
 * English, and those sentences are keys in the locale files. A key that is
 * missing falls back to the original text, which keeps a message that the
 * locale does not know readable.
 */
export function backendText(text: string): string {
  if (!text) return '';
  const exact = message(text);
  if (exact !== undefined) return exact;
  // A message of the backend that puts a value at its end, for example
  // "Another user has the callsign BH8GLN". Translate the part before the
  // value and keep the value as it is.
  const key = prefixKey(text);
  if (key) {
    const prefix = message(key);
    if (prefix !== undefined) return prefix + text.slice(key.length);
  }
  return text;
}
