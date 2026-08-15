export class ImageProviderError extends Error {
  constructor(message, { provider, status, code } = {}) {
    super(message);
    this.name = 'ImageProviderError';
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}
