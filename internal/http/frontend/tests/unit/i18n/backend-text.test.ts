// SPDX-License-Identifier: AGPL-3.0-or-later
// Verify that the messages of the backend turn into the text of the locale.
import { describe, it, expect } from 'vitest';
import { backendText, setLocale } from '@/i18n';

describe('backendText', () => {
  it('translates a message that is a key of the locale', () => {
    setLocale('zh-CN');
    expect(backendText('RadioID is invalid')).toBe('RadioID 无效');
    expect(backendText('DMR ID is not valid')).toBe('DMR ID 无效');
    expect(backendText('Callsign is already taken')).toBe('该呼号已被占用');
  });

  it('translates the part before the value of a message with a value', () => {
    setLocale('zh-CN');
    expect(backendText('Another user has the callsign BH8GLN')).toBe('已有其他用户使用呼号 BH8GLN');
  });

  it('keeps a message that the locale does not know', () => {
    setLocale('zh-CN');
    expect(backendText('Something nobody knows')).toBe('Something nobody knows');
    expect(backendText('')).toBe('');
  });

  it('keeps a message that holds a character of the template syntax', () => {
    setLocale('zh-CN');
    // The compiler of the templates reads the "@" of an email address as the
    // start of a linked message, so the message must not go through it.
    expect(backendText('Enter an email address, such as n0call@example.com')).toBe(
      '请输入邮箱地址，例如 n0call@example.com',
    );
    setLocale('en');
    expect(backendText('Enter an email address, such as n0call@example.com')).toBe(
      'Enter an email address, such as n0call@example.com',
    );
    setLocale('en');
  });

  it('shows the message of the backend in English in the English locale', () => {
    setLocale('en');
    expect(backendText('RadioID is invalid')).toBe('RadioID is invalid');
    setLocale('en');
  });
});
