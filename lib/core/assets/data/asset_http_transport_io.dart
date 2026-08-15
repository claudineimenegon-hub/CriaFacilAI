import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'asset_http_transport_base.dart';

AssetHttpTransport createAssetHttpTransport() => _IoAssetHttpTransport();

class _IoAssetHttpTransport implements AssetHttpTransport {
  final HttpClient _client = HttpClient();

  @override
  Future<AssetHttpResponse> postBytes(
    Uri uri,
    Uint8List bytes,
    String mimeType,
  ) async {
    final request = await _client.postUrl(uri);
    request.headers.contentType = ContentType.parse(mimeType);
    request.contentLength = bytes.length;
    request.add(bytes);
    final response = await request.close();
    return (
      statusCode: response.statusCode,
      body: await utf8.decoder.bind(response).join(),
    );
  }
}
