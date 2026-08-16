import 'dart:async';
import 'dart:typed_data';

typedef AssetHttpResponse = ({int statusCode, String body});

enum AssetHttpFailure { network, aborted, timeout }

class AssetHttpTransportException implements Exception {
  const AssetHttpTransportException(this.failure, this.message);

  final AssetHttpFailure failure;
  final String message;
}

class AssetHttpRequestCompletion {
  final _completer = Completer<AssetHttpResponse>();

  Future<AssetHttpResponse> get future => _completer.future;
  bool get isCompleted => _completer.isCompleted;

  void succeed(AssetHttpResponse response) {
    if (!_completer.isCompleted) _completer.complete(response);
  }

  void fail(AssetHttpFailure failure) {
    if (_completer.isCompleted) return;
    final message = switch (failure) {
      AssetHttpFailure.timeout => 'O envio demorou demais. Tente novamente.',
      AssetHttpFailure.aborted => 'O envio da imagem foi cancelado.',
      AssetHttpFailure.network =>
        'Não foi possível conectar ao servidor de upload.',
    };
    _completer.completeError(AssetHttpTransportException(failure, message));
  }
}

abstract interface class AssetHttpTransport {
  Future<AssetHttpResponse> postBytes(
    Uri uri,
    Uint8List bytes,
    String mimeType,
  );
}
