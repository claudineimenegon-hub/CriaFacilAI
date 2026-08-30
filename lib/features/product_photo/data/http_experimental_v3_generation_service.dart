import 'dart:async';
import 'dart:convert';

import '../../../core/config/app_config.dart';
import '../../../core/generation/generation_request.dart';
import '../../../core/generation/generation_types.dart';
import '../../image/data/http_transport.dart';
import '../domain/experimental_v3_generation_service.dart';

class HttpExperimentalV3GenerationService
    implements ExperimentalV3GenerationService, CanonicalAssetIsolationClient {
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

  Map<String, Object?> _payload(GenerationRequest request) {
    final common = request.generationParameters.common;
    return {
      'inputAssetId': request.inputs.single.id,
      'category': common.productCategory ?? 'general',
      'objective': common.artisticDirection ?? 'Campanha publicitária premium',
      'description': request.prompt,
      'aspectRatio': request.outputSpecification.aspectRatio,
    };
  }

  @override
  Future<CanonicalIsolationResult> isolateCanonicalAsset({
    required String analysisId,
    required String canonicalItemId,
    bool force = false,
  }) async {
    try {
      final response = await _transport
          .postJson(
            Uri.parse('$_baseUrl/api/experimental/v3/isolate'),
            jsonEncode({
              'analysisId': analysisId,
              'canonicalItemId': canonicalItemId,
              'force': force,
            }),
          )
          .timeout(const Duration(minutes: 3));
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ExperimentalV3GenerationException(
          body['error'] as String? ??
              'Não foi possível isolar esta referência.',
        );
      }
      final isolation = Map<String, dynamic>.from(body['isolation'] as Map);
      final rawAsset = isolation['asset'] == null
          ? null
          : Map<String, dynamic>.from(isolation['asset'] as Map);
      final relative = rawAsset?['temporaryUrl'] as String?;
      final assetUrl = relative == null
          ? null
          : Uri.parse('$_baseUrl/')
                .resolve(relative.replaceFirst(RegExp(r'^/'), ''))
                .toString();
      return CanonicalIsolationResult(
        canonicalItemId: isolation['canonicalItemId'] as String,
        asset: rawAsset == null
            ? null
            : AssetReference(
                id: rawAsset['id'] as String,
                mediaType: AssetMediaType.image,
                mimeType: rawAsset['mimeType'] as String,
                role: AssetRole.product,
                width: rawAsset['width'] as int,
                height: rawAsset['height'] as int,
                hash: rawAsset['hash'] as String?,
                temporaryUrl: assetUrl,
                retentionPolicy: AssetRetentionPolicy.temporary,
                expiresAt: DateTime.tryParse(
                  rawAsset['expiresAt'] as String? ?? '',
                ),
              ),
        isolationState: isolation['isolationState'] as String,
        isolationConfidence:
            (isolation['isolationConfidence'] as num?)?.toDouble() ?? 0,
        confirmable: isolation['confirmable'] == true,
        errorCode: isolation['errorCode'] as String?,
        retryable: isolation['retryable'] != false,
        userConfirmed: isolation['userConfirmed'] == true,
        sourceSha256: isolation['sourceSha256'] as String?,
        analysisId: isolation['analysisId'] as String?,
      );
    } on ExperimentalV3GenerationException {
      rethrow;
    } on Object {
      throw const ExperimentalV3GenerationException(
        'Não foi possível isolar esta referência agora.',
      );
    }
  }

  @override
  Future<CanonicalInventory> analyzeInventory(GenerationRequest request) async {
    if (_baseUrl.isEmpty) {
      throw const ExperimentalV3GenerationException(
        'O servidor do Creative Director ainda não foi configurado.',
      );
    }
    try {
      final response = await _transport
          .postJson(
            Uri.parse('$_baseUrl/api/experimental/v3/analyze'),
            jsonEncode(_payload(request)),
          )
          .timeout(const Duration(minutes: 3));
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ExperimentalV3GenerationException(
          body['error'] as String? ?? 'Não foi possível analisar o inventário.',
        );
      }
      final inventory = Map<String, dynamic>.from(body['inventory'] as Map);
      final source = Map<String, dynamic>.from(inventory['source'] as Map);
      return CanonicalInventory(
        analysisId: inventory['analysisId'] as String,
        items: (inventory['items'] as List)
            .map((raw) {
              final item = Map<String, dynamic>.from(raw as Map);
              return CanonicalInventoryItem(
                id: item['id'] as String,
                functionalType: item['functionalType'] as String,
                quantity: item['quantity'] as int,
              );
            })
            .toList(growable: false),
        source: AssetReference(
          id: source['assetId'] as String,
          mediaType: AssetMediaType.image,
          mimeType: source['mimeType'] as String,
          role: AssetRole.product,
          width: source['width'] as int,
          height: source['height'] as int,
          hash: source['sha256'] as String,
          internalReference: 'asset:${source['assetId']}',
          retentionPolicy: AssetRetentionPolicy.temporary,
        ),
      );
    } on ExperimentalV3GenerationException {
      rethrow;
    } on TimeoutException {
      throw const ExperimentalV3GenerationException(
        'A análise do inventário demorou demais.',
      );
    } on Object {
      throw const ExperimentalV3GenerationException(
        'Não foi possível analisar o inventário agora.',
      );
    }
  }

  @override
  Future<List<ExperimentalV3ImageResult>> generateFour(
    GenerationRequest request, {
    required String analysisId,
    required String quality,
    List<CanonicalVisualAssetBinding> canonicalVisualAssets = const [],
  }) async {
    if (_baseUrl.isEmpty) {
      throw const ExperimentalV3GenerationException(
        'O servidor do Creative Director ainda não foi configurado.',
      );
    }
    final payload = {
      ..._payload(request),
      'analysisId': analysisId,
      'idempotencyKey': request.idempotencyKey,
      'quality': quality,
      'canonicalVisualAssets': canonicalVisualAssets
          .map((binding) => binding.toJson())
          .toList(),
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
          body['error'] as String? ??
              'Não foi possível executar o Creative Director.',
        );
      }
      final batch = Map<String, dynamic>.from(
        body['batch'] as Map<dynamic, dynamic>,
      );
      final rawResults = (batch['results'] as List<dynamic>?) ?? const [];
      if (batch['expectedCount'] != 4 || rawResults.length != 4) {
        throw const ExperimentalV3GenerationException(
          'O servidor retornou um lote inválido do Creative Director.',
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
        'O Creative Director demorou demais. Tente novamente.',
      );
    } on FormatException {
      throw const ExperimentalV3GenerationException(
        'O servidor retornou uma resposta inválida do Creative Director.',
      );
    } on ImageHttpTransportException catch (error) {
      throw ExperimentalV3GenerationException(error.message);
    } catch (_) {
      throw const ExperimentalV3GenerationException(
        'Não foi possível executar o Creative Director agora.',
      );
    }
  }
}
