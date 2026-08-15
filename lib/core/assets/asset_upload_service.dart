import 'dart:typed_data';

import '../generation/generation_types.dart';

abstract interface class AssetUploadService {
  Future<AssetReference> uploadImage({
    required Uint8List bytes,
    required String mimeType,
    AssetRole role = AssetRole.product,
  });
}

class AssetUploadException implements Exception {
  const AssetUploadException(this.message);

  final String message;

  @override
  String toString() => message;
}
