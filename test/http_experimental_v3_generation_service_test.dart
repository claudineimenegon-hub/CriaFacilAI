import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/generation/generation_request.dart';
import 'package:meu_app/core/generation/generation_types.dart';
import 'package:meu_app/features/image/data/http_transport.dart';
import 'package:meu_app/features/product_photo/data/http_experimental_v3_generation_service.dart';

void main() {
  test('analisa inventário e preserva IDs fornecidos pelo backend', () async {
    final transport = _Transport();
    final service = HttpExperimentalV3GenerationService(
      baseUrl: 'http://api.example',
      transport: transport,
    );
    final inventory = await service.analyzeInventory(_request());
    expect(transport.uri?.path, '/api/experimental/v3/analyze');
    expect(inventory.items.single.id, 'canonical-product');
    expect(
      inventory.analysisId,
      '00000000-0000-4000-8000-000000000099',
    );
    expect(
      inventory.source.hash,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });

  test('envia contrato V3 amigável e preserva sucessos parciais', () async {
    final transport = _Transport();
    final service = HttpExperimentalV3GenerationService(
      baseUrl: 'http://api.example',
      transport: transport,
    );
    final results = await service.generateFour(
      _request(),
      analysisId: '00000000-0000-4000-8000-000000000099',
      quality: 'high',
    );

    expect(transport.uri?.path, '/api/experimental/v3/generate');
    expect(transport.payload, containsPair('inputAssetId', 'asset-1'));
    expect(transport.payload, containsPair('category', 'beverages'));
    expect(transport.payload, containsPair('quality', 'high'));
    expect(
      transport.payload,
      containsPair('analysisId', '00000000-0000-4000-8000-000000000099'),
    );
    expect(transport.payload, containsPair('idempotencyKey', 'v3-request'));
    expect(transport.payload.toString(), isNot(contains('OPENAI_API_KEY')));
    expect(results, hasLength(4));
    expect(results.where((result) => result.isCompleted), hasLength(3));
    expect(results.last.errorMessage, 'Não foi possível gerar esta proposta.');
  });
}

GenerationRequest _request() => GenerationRequest(
  operation: GenerationOperation.imageToImage,
  prompt: 'Campanha premium para bebida',
  inputs: const [
    AssetReference(
      id: 'asset-1',
      mediaType: AssetMediaType.image,
      mimeType: 'image/png',
      role: AssetRole.product,
      width: 600,
      height: 600,
      internalReference: 'asset:asset-1',
      retentionPolicy: AssetRetentionPolicy.temporary,
    ),
  ],
  preservationOptions: const PreservationOptions(preserveProduct: true),
  generationParameters: const GenerationParameters(
    common: CommonGenerationParameters(
      aspectRatio: '1:1',
      resolution: '1024x1024',
      outputFormat: OutputFormat.png,
      productCategory: 'beverages',
      artisticDirection: 'Lifestyle',
    ),
    image: ImageGenerationParameters(),
  ),
  outputSpecification: const OutputSpecification.fourImages(),
  idempotencyKey: 'v3-request',
);

class _Transport implements ImageHttpTransport {
  Uri? uri;
  Map<String, dynamic>? payload;

  @override
  Future<ImageHttpResponse> postJson(Uri uri, String body) async {
    this.uri = uri;
    payload = jsonDecode(body) as Map<String, dynamic>;
    if (uri.path.endsWith('/analyze')) {
      return (
        statusCode: 200,
        body: jsonEncode({
          'inventory': {
            'analysisId': '00000000-0000-4000-8000-000000000099',
            'items': [
              {
                'id': 'canonical-product',
                'functionalType': 'product',
                'quantity': 1,
              },
            ],
            'source': {
              'assetId': 'asset-1',
              'mimeType': 'image/png',
              'width': 600,
              'height': 600,
              'sha256': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            },
          },
        }),
      );
    }
    return (
      statusCode: 200,
      body: jsonEncode({
        'batch': {
          'expectedCount': 4,
          'status': 'partial',
          'quality': 'high',
          'results': [
            for (final role in [
              'hero_commercial',
              'contextual_lifestyle',
              'editorial_craft_detail',
            ])
              {
                'campaignRole': role,
                'status': 'completed',
                'imageBase64': base64Encode([1, 2, 3]),
              },
            {
              'campaignRole': 'concept_campaign',
              'status': 'error',
              'errorCode': 'UPSTREAM_TIMEOUT',
            },
          ],
        },
      }),
    );
  }
}
