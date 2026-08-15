import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import '../../../core/config/app_config.dart';
import '../domain/image_generation_service.dart';
import 'http_transport.dart';

class HttpImageGenerationService implements ImageGenerationService {
  HttpImageGenerationService({String? baseUrl, ImageHttpTransport? transport})
    : _baseUrl = (baseUrl ?? AppConfig.apiBaseUrl).replaceAll(
        RegExp(r'/+$'),
        '',
      ),
      _transport = transport ?? createImageHttpTransport();

  final String _baseUrl;
  final ImageHttpTransport _transport;

  @override
  Future<Uint8List> generate({required String prompt}) async {
    final images = await _generate(prompt: prompt, count: 1);
    return images.first;
  }

  @override
  Future<List<Uint8List>> generateMany({
    required String prompt,
    required int count,
  }) {
    if (count < 1 || count > 4) {
      throw ArgumentError.value(count, 'count', 'deve estar entre 1 e 4');
    }
    return _generate(prompt: prompt, count: count);
  }

  Future<List<Uint8List>> _generate({
    required String prompt,
    required int count,
  }) async {
    if (_baseUrl.isEmpty) {
      throw const ImageGenerationException(
        'O servidor de geração ainda não foi configurado neste aplicativo.',
      );
    }

    try {
      final response = await _transport
          .postJson(
            Uri.parse('$_baseUrl/v1/images/generate'),
            jsonEncode({'prompt': prompt, 'count': count}),
          )
          .timeout(const Duration(minutes: 3));
      final payload = jsonDecode(response.body) as Map<String, dynamic>;

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ImageGenerationException(
          payload['error'] as String? ?? 'Não foi possível gerar a imagem.',
        );
      }

      final encodedImages = switch (payload['imagesBase64']) {
        final List<dynamic> images => images.whereType<String>().toList(),
        _ => <String>[],
      };
      final fallbackImage = payload['imageBase64'] as String?;
      if (encodedImages.isEmpty && fallbackImage?.isNotEmpty == true) {
        encodedImages.add(fallbackImage!);
      }
      if (encodedImages.length != count ||
          encodedImages.any((image) => image.isEmpty)) {
        throw const ImageGenerationException(
          'O servidor não retornou todas as imagens solicitadas.',
        );
      }
      return encodedImages.map(base64Decode).toList(growable: false);
    } on ImageGenerationException {
      rethrow;
    } on TimeoutException {
      throw const ImageGenerationException(
        'A geração demorou demais. Tente novamente.',
      );
    } on FormatException {
      throw const ImageGenerationException(
        'O servidor retornou uma resposta inválida.',
      );
    } on Exception {
      throw const ImageGenerationException(
        'A geração demorou demais ou encontrou um erro inesperado.',
      );
    }
  }
}
