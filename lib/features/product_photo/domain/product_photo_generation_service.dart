import 'dart:typed_data';

import '../../../core/generation/generation_request.dart';

abstract interface class ProductPhotoGenerationService {
  Future<List<Uint8List>> generateFour(GenerationRequest request);
}

class ProductPhotoGenerationException implements Exception {
  const ProductPhotoGenerationException(this.message);

  final String message;

  @override
  String toString() => message;
}
