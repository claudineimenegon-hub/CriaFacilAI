export class ImageToImageProviderError extends Error {
  constructor(message, { provider, status, code } = {}) {
    super(message);
    this.name = 'ImageToImageProviderError';
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

export function assertImageToImageRequest(request) {
  if (typeof request?.prompt !== 'string' || request.prompt.trim().length < 3) {
    throw new TypeError('ImageToImageProvider requer um prompt válido.');
  }
  if (!Array.isArray(request.inputs) || request.inputs.length < 1 || request.inputs.length > 4) {
    throw new TypeError('ImageToImageProvider requer entre uma e quatro referências.');
  }
  if (!request.parameters || !request.preservation || !request.output) {
    throw new TypeError('ImageToImageProvider requer parâmetros, preservação e saída.');
  }
}
