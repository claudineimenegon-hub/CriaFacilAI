// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:async';
import 'dart:html' as html;

import 'http_transport_base.dart';

ImageHttpTransport createImageHttpTransport() => _WebImageHttpTransport();

class _WebImageHttpTransport implements ImageHttpTransport {
  static const _generationTimeout = Duration(minutes: 5);

  @override
  Future<ImageHttpResponse> postJson(Uri uri, String body) async {
    final request = html.HttpRequest();
    final completion = ImageHttpRequestCompletion();
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
        (_) => finish(() => completion.fail(ImageHttpFailure.network)),
      ),
    );
    subscriptions.add(
      request.onAbort.listen(
        (_) => finish(() => completion.fail(ImageHttpFailure.aborted)),
      ),
    );
    subscriptions.add(
      request.onTimeout.listen(
        (_) => finish(() => completion.fail(ImageHttpFailure.timeout)),
      ),
    );

    try {
      request
        ..open('POST', uri.toString())
        ..timeout = _generationTimeout.inMilliseconds
        ..setRequestHeader('Content-Type', 'application/json')
        ..send(body);
    } catch (_) {
      finish(() => completion.fail(ImageHttpFailure.network));
    }
    return completion.future;
  }
}
