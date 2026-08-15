import 'dart:convert';
import 'dart:io';

import 'http_transport_base.dart';

ImageHttpTransport createImageHttpTransport() => _IoImageHttpTransport();

class _IoImageHttpTransport implements ImageHttpTransport {
  final HttpClient _client = HttpClient();

  @override
  Future<ImageHttpResponse> postJson(Uri uri, String body) async {
    final request = await _client.postUrl(uri);
    request.headers.contentType = ContentType.json;
    request.write(body);
    final response = await request.close();
    return (
      statusCode: response.statusCode,
      body: await utf8.decoder.bind(response).join(),
    );
  }
}
