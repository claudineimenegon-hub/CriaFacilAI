import 'dart:typed_data';

abstract interface class ImageGenerationService {
  Future<Uint8List> generate({required String prompt});

  Future<List<Uint8List>> generateMany({
    required String prompt,
    required int count,
  });
}

class ImageGenerationException implements Exception {
  const ImageGenerationException(this.message);

  final String message;

  @override
  String toString() => message;
}
