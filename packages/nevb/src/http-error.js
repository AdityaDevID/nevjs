export const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  409: 'Conflict', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity',
  429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/** Throw this (or call abort()) from any handler to produce an HTTP error response. */
export class HttpError extends Error {
  constructor(status = 500, message, details) {
    super(message ?? STATUS_TEXT[status] ?? 'Error');
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
    this.expose = status < 500;
  }
}

export function abort(status, message, details) {
  throw new HttpError(status, message, details);
}
