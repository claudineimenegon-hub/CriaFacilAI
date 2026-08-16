// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:async';
import 'dart:html' as html;
import 'dart:typed_data';

import 'asset_http_transport_base.dart';

AssetHttpTransport createAssetHttpTransport() => _WebAssetHttpTransport();

class _WebAssetHttpTransport implements AssetHttpTransport {
  static const _uploadTimeout = Duration(seconds: 30);

  @override
  Future<AssetHttpResponse> postBytes(
    Uri uri,
    Uint8List bytes,
    String mimeType,
  ) async {
    final request = html.HttpRequest();
    final completion = AssetHttpRequestCompletion();
    final subscriptions = <StreamSubscription<html.ProgressEvent>>[];

    void finish(void Function() action) {
      if (completion.isCompleted) return;
      action();
      for (final subscription in subscriptions) {
        unawaited(subscription.cancel());
      }
    }

    subscriptions.add(
      request.onLoad.listen((_) {
        finish(
          () => completion.succeed((
            statusCode: request.status ?? 0,
            body: request.responseText ?? '',
          )),
        );
      }),
    );
    subscriptions.add(
      request.onError.listen(
        (_) => finish(() => completion.fail(AssetHttpFailure.network)),
      ),
    );
    subscriptions.add(
      request.onAbort.listen(
        (_) => finish(() => completion.fail(AssetHttpFailure.aborted)),
      ),
    );
    subscriptions.add(
      request.onTimeout.listen(
        (_) => finish(() => completion.fail(AssetHttpFailure.timeout)),
      ),
    );

    try {
      request
        ..open('POST', uri.toString())
        ..timeout = _uploadTimeout.inMilliseconds
        ..setRequestHeader('Content-Type', mimeType)
        ..send(bytes);
    } catch (_) {
      finish(() => completion.fail(AssetHttpFailure.network));
    }
    return completion.future;
  }
}
