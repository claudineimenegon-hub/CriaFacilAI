import 'dart:typed_data';

abstract interface class ImageGenerationService {
  Future<Uint8List> generate({
    required String prompt,
    String aspectRatio = '1:1',
  });

  Future<List<Uint8List>> generateMany({
    required String prompt,
    required int count,
    String aspectRatio = '1:1',
  });
}

class ImageGenerationException implements Exception {
  const ImageGenerationException(this.message);

  final String message;

  @override
  String toString() => message;
}
