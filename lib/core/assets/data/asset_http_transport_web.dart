// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;
import 'dart:typed_data';

import 'asset_http_transport_base.dart';

AssetHttpTransport createAssetHttpTransport() => _WebAssetHttpTransport();

class _WebAssetHttpTransport implements AssetHttpTransport {
  @override
  Future<AssetHttpResponse> postBytes(
    Uri uri,
    Uint8List bytes,
    String mimeType,
  ) async {
    final response = await html.HttpRequest.request(
      uri.toString(),
      method: 'POST',
      requestHeaders: {'Content-Type': mimeType},
      sendData: bytes,
    );
    return (
      statusCode: response.status ?? 0,
      body: response.responseText ?? '',
    );
  }
}
