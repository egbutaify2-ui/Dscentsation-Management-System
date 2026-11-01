import { describe, expect, it } from 'vitest';
import { assertProductionSecurityConfig } from './security-config.js';

const secureConfig = {
  sessionIdleTimeoutMinutes: 30,
  sessionAbsoluteTimeoutHours: 12,
  cookieSecure: true,
  appOrigin: 'https://dms.example.invalid',
};

describe('production security configuration', () => {
  it('accepts explicit HTTPS, secure-cookie and session-lifetime settings', () => {
    expect(() => assertProductionSecurityConfig(secureConfig)).not.toThrow();
  });

  it('refuses missing session-lifetime settings', () => {
    expect(() =>
      assertProductionSecurityConfig({
        ...secureConfig,
        sessionIdleTimeoutMinutes: undefined,
        sessionAbsoluteTimeoutHours: undefined,
      }),
    ).toThrow(/SESSION_IDLE_TIMEOUT_MINUTES.*SESSION_ABSOLUTE_TIMEOUT_HOURS/);
  });

  it('refuses insecure cookies in production', () => {
    expect(() =>
      assertProductionSecurityConfig({
        ...secureConfig,
        cookieSecure: false,
      }),
    ).toThrow(/COOKIE_SECURE=true/);
  });

  it('refuses non-HTTPS production origins', () => {
    expect(() =>
      assertProductionSecurityConfig({
        ...secureConfig,
        appOrigin: 'http://dms.example.invalid',
      }),
    ).toThrow(/APP_ORIGIN must use HTTPS/);
  });
});
