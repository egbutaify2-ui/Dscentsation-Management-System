export interface ProductionSecurityConfig {
  sessionIdleTimeoutMinutes: number | undefined;
  sessionAbsoluteTimeoutHours: number | undefined;
  cookieSecure: boolean;
  appOrigin: string;
}

export function assertProductionSecurityConfig(config: ProductionSecurityConfig): void {
  const errors: string[] = [];

  if (!config.sessionIdleTimeoutMinutes) errors.push('SESSION_IDLE_TIMEOUT_MINUTES');
  if (!config.sessionAbsoluteTimeoutHours) errors.push('SESSION_ABSOLUTE_TIMEOUT_HOURS');
  if (!config.cookieSecure) errors.push('COOKIE_SECURE=true');

  let originProtocol: string;
  try {
    originProtocol = new URL(config.appOrigin).protocol;
  } catch {
    originProtocol = '';
  }
  if (originProtocol !== 'https:') errors.push('APP_ORIGIN must use HTTPS');

  if (errors.length > 0) {
    throw new Error(
      `Production session/security configuration is incomplete: ${errors.join(', ')}. ` +
        'Production policy values require explicit approval.',
    );
  }
}
