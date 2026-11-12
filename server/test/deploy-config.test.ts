import { describe, it, expect } from 'vitest';
import { allowedOrigins, emailConfirmationRequired, pgSslOption, resolveBindHost, resolvePort, SPA_FALLBACK } from '../src/config.js';

describe('resolvePort / bind host', () => {
  it('prefers PORT (Render) over SERVER_PORT', () => {
    expect(resolvePort({ PORT: '10000', SERVER_PORT: '2567' })).toBe(10000);
    expect(resolvePort({ SERVER_PORT: '2567' })).toBe(2567);
    expect(resolvePort({})).toBe(2567);
  });
  it('binds 0.0.0.0 unless BIND_HOST is set', () => {
    expect(resolveBindHost({})).toBe('0.0.0.0');
    expect(resolveBindHost({ BIND_HOST: '127.0.0.1' })).toBe('127.0.0.1');
  });
});

describe('pgSslOption', () => {
  const remote = 'postgres://u:p@dpg-xxxx.render.com:5432/astral';
  const local = 'postgres://u:p@127.0.0.1:5433/astral';
  it('enables SSL for remote production URLs (Render)', () => {
    expect(pgSslOption(remote, { NODE_ENV: 'production' })).toEqual({ rejectUnauthorized: false });
  });
  it('honors sslmode=require even in development', () => {
    expect(pgSslOption(remote + '?sslmode=require', { NODE_ENV: 'development' })).toEqual({ rejectUnauthorized: false });
  });
  it('verifies the cert when sslmode=verify-full or DATABASE_SSL_REJECT_UNAUTHORIZED=true', () => {
    expect(pgSslOption(remote + '?sslmode=verify-full', { NODE_ENV: 'production' })).toEqual({ rejectUnauthorized: true });
    expect(pgSslOption(remote, { NODE_ENV: 'production', DATABASE_SSL_REJECT_UNAUTHORIZED: 'true' })).toEqual({ rejectUnauthorized: true });
  });
  it('does not force SSL for local production-like runs', () => {
    expect(pgSslOption(local, { NODE_ENV: 'production' })).toBeUndefined();
    expect(pgSslOption(local + '?sslmode=disable', { NODE_ENV: 'production', DATABASE_SSL: 'true' })).toBeUndefined();
  });
  it('DATABASE_SSL flag forces on or off', () => {
    expect(pgSslOption(local, { DATABASE_SSL: 'true' })).toEqual({ rejectUnauthorized: false });
    expect(pgSslOption(remote, { NODE_ENV: 'production', DATABASE_SSL: 'false' })).toBeUndefined();
  });
});

describe('emailConfirmationRequired', () => {
  it('defaults to required in production and optional in development', () => {
    expect(emailConfirmationRequired({ NODE_ENV: 'production' })).toBe(true);
    expect(emailConfirmationRequired({ NODE_ENV: 'development' })).toBe(false);
  });
  it('EMAIL_CONFIRM=1 still forces it on (existing tests)', () => {
    expect(emailConfirmationRequired({ NODE_ENV: 'development', EMAIL_CONFIRM: '1' })).toBe(true);
  });
  it('REQUIRE_EMAIL_CONFIRMATION overrides the production default (playtest, no SMTP)', () => {
    expect(emailConfirmationRequired({ NODE_ENV: 'production', REQUIRE_EMAIL_CONFIRMATION: 'false' })).toBe(false);
    expect(emailConfirmationRequired({ NODE_ENV: 'production', REQUIRE_EMAIL_CONFIRMATION: '0' })).toBe(false);
    expect(emailConfirmationRequired({ NODE_ENV: 'development', REQUIRE_EMAIL_CONFIRMATION: 'true' })).toBe(true);
  });
});

describe('SPA_FALLBACK / allowedOrigins', () => {
  it('does not capture /api, /health, or /matchmake', () => {
    expect(SPA_FALLBACK.test('/')).toBe(true);
    expect(SPA_FALLBACK.test('/play')).toBe(true);
    expect(SPA_FALLBACK.test('/admin.html')).toBe(true);
    expect(SPA_FALLBACK.test('/api/status')).toBe(false);
    expect(SPA_FALLBACK.test('/health')).toBe(false);
    expect(SPA_FALLBACK.test('/matchmake')).toBe(false);
    expect(SPA_FALLBACK.test('/matchmake/join/world')).toBe(false);
  });
  it('pins WebSocket origin to RENDER_EXTERNAL_URL when ALLOWED_ORIGINS is empty', () => {
    expect(allowedOrigins({})).toEqual([]);
    expect(allowedOrigins({ RENDER_EXTERNAL_URL: 'https://astral.onrender.com/' })).toEqual(['https://astral.onrender.com']);
    expect(allowedOrigins({ ALLOWED_ORIGINS: 'https://game.example.com', RENDER_EXTERNAL_URL: 'https://astral.onrender.com' })).toEqual(['https://game.example.com']);
  });
});
