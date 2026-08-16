import 'dart:async';

typedef ImageHttpResponse = ({int statusCode, String body});

enum ImageHttpFailure { network, aborted, timeout }

class ImageHttpTransportException implements Exception {
  const ImageHttpTransportException(this.failure, this.message);

  final ImageHttpFailure failure;
  final String message;
}

class ImageHttpRequestCompletion {
  final _completer = Completer<ImageHttpResponse>();

  Future<ImageHttpResponse> get future => _completer.future;
  bool get isCompleted => _completer.isCompleted;

  void succeed(ImageHttpResponse response) {
    if (!_completer.isCompleted) _completer.complete(response);
  }

  void fail(ImageHttpFailure failure) {
    if (_completer.isCompleted) return;
    final message = switch (failure) {
      ImageHttpFailure.timeout => 'A geração demorou demais. Tente novamente.',
      ImageHttpFailure.aborted => 'A geração foi cancelada.',
      ImageHttpFailure.network =>
        'Não foi possível conectar ao servidor de geração.',
    };
    _completer.completeError(ImageHttpTransportException(failure, message));
  }
}

abstract interface class ImageHttpTransport {
  Future<ImageHttpResponse> postJson(Uri uri, String body);
}
