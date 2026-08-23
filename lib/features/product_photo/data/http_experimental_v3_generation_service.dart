import 'dart:async';
import 'dart:convert';

import '../../../core/config/app_config.dart';
import '../../../core/generation/generation_request.dart';
import '../../image/data/http_transport.dart';
import '../domain/experimental_v3_generation_service.dart';

class HttpExperimentalV3GenerationService
    implements ExperimentalV3GenerationService {
  HttpExperimentalV3GenerationService({
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
  Future<List<ExperimentalV3ImageResult>> generateFour(
    GenerationRequest request, {
    required String quality,
  }) async {
    if (_baseUrl.isEmpty) {
      throw const ExperimentalV3GenerationException(
        'O servidor experimental ainda não foi configurado.',
      );
    }
    final common = request.generationParameters.common;
    final payload = {
      'inputAssetId': request.inputs.single.id,
      'category': common.productCategory ?? 'general',
      'objective': common.artisticDirection ?? 'Campanha publicitária premium',
      'description': request.prompt,
      'aspectRatio': request.outputSpecification.aspectRatio,
      'quality': quality,
    };
    try {
      final response = await _transport
          .postJson(
            Uri.parse('$_baseUrl/api/experimental/v3/generate'),
            jsonEncode(payload),
          )
          .timeout(const Duration(minutes: 25));
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ExperimentalV3GenerationException(
          body['error'] as String? ?? 'Não foi possível executar o teste V3.',
        );
      }
      final batch = Map<String, dynamic>.from(
        body['batch'] as Map<dynamic, dynamic>,
      );
      final rawResults = (batch['results'] as List<dynamic>?) ?? const [];
      if (batch['expectedCount'] != 4 || rawResults.length != 4) {
        throw const ExperimentalV3GenerationException(
          'O servidor retornou um lote V3 inválido.',
        );
      }
      return rawResults
          .map((value) {
            final item = Map<String, dynamic>.from(
              value as Map<dynamic, dynamic>,
            );
            final encoded = item['imageBase64'] as String?;
            return ExperimentalV3ImageResult(
              campaignRole: item['campaignRole'] as String,
              status: item['status'] as String,
              imageBytes: encoded == null || encoded.isEmpty
                  ? null
                  : base64Decode(encoded),
              errorMessage: item['status'] == 'error'
                  ? 'Não foi possível gerar esta proposta.'
                  : null,
            );
          })
          .toList(growable: false);
    } on ExperimentalV3GenerationException {
      rethrow;
    } on TimeoutException {
      throw const ExperimentalV3GenerationException(
        'O teste V3 demorou demais. Tente novamente.',
      );
    } on FormatException {
      throw const ExperimentalV3GenerationException(
        'O servidor retornou uma resposta experimental inválida.',
      );
    } on ImageHttpTransportException catch (error) {
      throw ExperimentalV3GenerationException(error.message);
    } catch (_) {
      throw const ExperimentalV3GenerationException(
        'Não foi possível executar o teste V3 agora.',
      );
    }
  }
}
