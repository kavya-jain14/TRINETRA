import pino, { type Logger, type LoggerOptions } from 'pino';

const redactedPaths = [
  'req.headers.authorization',
  'req.headers.x-signature',
  'req.headers.x-partner-key',
  'headers.authorization',
  'headers.x-signature',
  'secret',
  '*.secret',
  'upi_pin',
  '*.upi_pin',
  'vpa',
  '*.vpa',
];

export function createLoggerOptions(level = 'info'): LoggerOptions {
  return {
    level,
    redact: { paths: redactedPaths, censor: '[REDACTED]' },
    base: null,
  };
}

export function createLogger(level = 'info'): Logger {
  return pino(createLoggerOptions(level));
}
