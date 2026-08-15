import 'dart:typed_data';

typedef AssetHttpResponse = ({int statusCode, String body});

abstract interface class AssetHttpTransport {
  Future<AssetHttpResponse> postBytes(
    Uri uri,
    Uint8List bytes,
    String mimeType,
  );
}
