import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/generation/generation_request.dart';
import 'package:meu_app/core/generation/generation_types.dart';
import 'package:meu_app/features/image/data/http_transport.dart';
import 'package:meu_app/features/product_photo/data/http_product_photo_generation_service.dart';

void main() {
  test('envia somente IDs de assets e decodifica quatro propostas', () async {
    final encoded = List.generate(4, (index) => base64Encode([index + 1]));
    final transport = _FakeTransport({
      'batch': {
        'expectedCount': 4,
        'status': 'completed',
        'imagesBase64': encoded,
      },
    });
    final service = HttpProductPhotoGenerationService(
      baseUrl: 'http://api.example',
      transport: transport,
    );

    final images = await service.generateFour(_request());

    expect(images.map((image) => image.single), [1, 2, 3, 4]);
    expect(transport.payload?['inputAssetIds'], ['asset-1']);
    expect(transport.payload?['count'], 4);
    expect(transport.payload?['quality'], 'standard');
    expect(transport.payload.toString(), isNot(contains('imageBase64')));
  });
}

GenerationRequest _request() => GenerationRequest(
  operation: GenerationOperation.imageToImage,
  prompt: 'Campanha premium',
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
    ),
    image: ImageGenerationParameters(),
  ),
  outputSpecification: const OutputSpecification.fourImages(),
  idempotencyKey: 'request-1',
);

class _FakeTransport implements ImageHttpTransport {
  _FakeTransport(this.response);
  final Map<String, Object?> response;
  Map<String, dynamic>? payload;

  @override
  Future<ImageHttpResponse> postJson(Uri uri, String body) async {
    payload = jsonDecode(body) as Map<String, dynamic>;
    expect(uri.path, '/v1/images/transform');
    return (statusCode: 200, body: jsonEncode(response));
  }
}
