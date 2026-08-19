export class ImageToImageProviderError extends Error {
  constructor(message, {
    provider, status, code, category, providerErrorType, invalidFields,
    upstreamMessage, upstreamRequestId, proposalIndex, retryAttempt,
    errorOrigin, failurePhase, upstreamStatusHttp,
  } = {}) {
    super(message);
    this.name = 'ImageToImageProviderError';
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.category = category;
    this.providerErrorType = providerErrorType;
    this.invalidFields = Object.freeze([...(invalidFields ?? [])]);
    this.upstreamMessage = upstreamMessage;
    this.upstreamRequestId = upstreamRequestId;
    this.proposalIndex = proposalIndex;
    this.retryAttempt = retryAttempt;
    this.errorOrigin = errorOrigin;
    this.failurePhase = failurePhase;
    this.upstreamStatusHttp = Number.isInteger(upstreamStatusHttp) ? upstreamStatusHttp : null;
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
