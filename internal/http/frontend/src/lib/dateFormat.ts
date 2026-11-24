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

import {
  format as formatDate,
  formatDistance as formatDistanceBase,
  formatDistanceStrict as formatDistanceStrictBase,
  formatDistanceToNow as formatDistanceToNowBase,
  formatDistanceToNowStrict as formatDistanceToNowStrictBase,
  type FormatDistanceOptions,
  type FormatDistanceStrictOptions,
  type Locale as DateLocale,
} from 'date-fns';
import { enUS } from 'date-fns/locale';
import { zhCN } from 'date-fns/locale';
import { i18n } from '@/i18n';

/**
 * date-fns ships a locale per language. Without one, the month and the
 * weekday stay English ("Nov 23") even when the rest of the page is Chinese.
 * The locale follows the language the user picked in the settings.
 */
function currentDateLocale(): DateLocale {
  return i18n.global.locale.value === 'zh-CN' ? zhCN : enUS;
}

/**
 * formatDateTime - format a date with the pattern of the current language.
 * Same signature as date-fns format(), with the locale filled in.
 */
export function formatDateTime(date: Date | string | number, pattern: string): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return formatDate(value, pattern, { locale: currentDateLocale() });
}

/**
 * The "about 2 hours ago" family. date-fns writes the unit and the suffix in
 * the locale of the option, so the English build stays English and the
 * Chinese one reads "大约 2 小时前".
 */
export function formatDistance(
  date: Date | string | number,
  baseDate: Date | string | number,
  options?: FormatDistanceOptions
): string {
  return formatDistanceBase(date, baseDate, { ...options, locale: currentDateLocale() });
}

export function formatDistanceStrict(
  date: Date | string | number,
  baseDate: Date | string | number,
  options?: FormatDistanceStrictOptions
): string {
  return formatDistanceStrictBase(date, baseDate, { ...options, locale: currentDateLocale() });
}

export function formatDistanceToNow(date: Date | string | number, options?: FormatDistanceOptions): string {
  return formatDistanceToNowBase(date, { ...options, locale: currentDateLocale() });
}

export function formatDistanceToNowStrict(
  date: Date | string | number,
  options?: FormatDistanceStrictOptions
): string {
  return formatDistanceToNowStrictBase(date, { ...options, locale: currentDateLocale() });
}

// Aliases with the "Local" suffix. The call sites import these under the
// date-fns names, so a rename of the date-fns export cannot break them.
export {
  formatDistance as formatDistanceLocal,
  formatDistanceStrict as formatDistanceStrictLocal,
  formatDistanceToNow as formatDistanceToNowLocal,
  formatDistanceToNowStrict as formatDistanceToNowStrictLocal,
};
