import 'dart:typed_data';

import '../../../core/generation/generation_request.dart';

class ExperimentalV3ImageResult {
  const ExperimentalV3ImageResult({
    required this.campaignRole,
    required this.status,
    this.imageBytes,
    this.errorMessage,
  });

  final String campaignRole;
  final String status;
  final Uint8List? imageBytes;
  final String? errorMessage;

  bool get isCompleted => status == 'completed' && imageBytes != null;
}

abstract interface class ExperimentalV3GenerationService {
  Future<List<ExperimentalV3ImageResult>> generateFour(
    GenerationRequest request, {
    required String quality,
  });
}

class ExperimentalV3GenerationException implements Exception {
  const ExperimentalV3GenerationException(this.message);
  final String message;

  @override
  String toString() => message;
}
