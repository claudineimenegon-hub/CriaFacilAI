import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import '../../../core/config/app_config.dart';
import '../../../core/generation/generation_request.dart';
import '../../image/data/http_transport.dart';
import '../domain/product_photo_generation_service.dart';

class HttpProductPhotoGenerationService
    implements ProductPhotoGenerationService {
  HttpProductPhotoGenerationService({
    String? baseUrl,
    ImageHttpTransport? transport,
  }) : _baseUrl = (baseUrl ?? AppConfig.apiBaseUrl).replaceAll(
         RegExp(r'/+$'),
         '',
       ),
       _transport = transport ?? createImageHttpTransport();

  final String _baseUrl;
  final ImageHttpTransport _transport;

  @override
  Future<List<Uint8List>> generateFour(GenerationRequest request) async {
    if (_baseUrl.isEmpty) {
      throw const ProductPhotoGenerationException(
        'O servidor de geração ainda não foi configurado.',
      );
    }
    if (request.outputSpecification.count != 4) {
      throw const ProductPhotoGenerationException(
        'Foto Publicitária requer exatamente quatro propostas.',
      );
    }
    final payload = {
      'operation': request.operation.name,
      'prompt': request.prompt,
      'inputAssetIds': request.inputs.map((asset) => asset.id).toList(),
      'count': 4,
      'quality': request.outputSpecification.quality.name,
      'aspectRatio': request.outputSpecification.aspectRatio,
      'preservation': request.preservationOptions.toJson(),
      'parameters': request.generationParameters.toJson(),
      'idempotencyKey': request.idempotencyKey,
    };
    try {
      final response = await _transport
          .postJson(
            Uri.parse('$_baseUrl/v1/images/transform'),
            jsonEncode(payload),
          )
          .timeout(const Duration(minutes: 5));
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ProductPhotoGenerationException(
          body['error'] as String? ?? 'Não foi possível criar as propostas.',
        );
      }
      final batch = Map<String, dynamic>.from(
        body['batch'] as Map<dynamic, dynamic>,
      );
      final images = switch (batch['imagesBase64']) {
        final List<dynamic> values => values.whereType<String>().toList(),
        _ => <String>[],
      };
      if (batch['status'] != 'completed' ||
          batch['expectedCount'] != 4 ||
          images.length != 4 ||
          images.any((image) => image.isEmpty)) {
        throw const ProductPhotoGenerationException(
          'O servidor não retornou as quatro propostas completas.',
        );
      }
      return images.map(base64Decode).toList(growable: false);
    } on ProductPhotoGenerationException {
      rethrow;
    } on TimeoutException {
      throw const ProductPhotoGenerationException(
        'A geração demorou demais. Tente novamente.',
      );
    } on FormatException {
      throw const ProductPhotoGenerationException(
        'O servidor retornou uma resposta inválida.',
      );
    } on Exception {
      throw const ProductPhotoGenerationException(
        'Não foi possível criar as propostas agora.',
      );
    }
  }
}
