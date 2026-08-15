// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;

import 'http_transport_base.dart';

ImageHttpTransport createImageHttpTransport() => _WebImageHttpTransport();

class _WebImageHttpTransport implements ImageHttpTransport {
  @override
  Future<ImageHttpResponse> postJson(Uri uri, String body) async {
    final response = await html.HttpRequest.request(
      uri.toString(),
      method: 'POST',
      requestHeaders: const {'Content-Type': 'application/json'},
      sendData: body,
    );
    return (
      statusCode: response.status ?? 0,
      body: response.responseText ?? '',
    );
  }
}
