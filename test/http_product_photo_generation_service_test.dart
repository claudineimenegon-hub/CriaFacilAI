import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/generation/generation_request.dart';
import 'package:meu_app/core/generation/generation_types.dart';
import 'package:meu_app/features/image/data/http_transport.dart';
import 'package:meu_app/features/product_photo/data/http_product_photo_generation_service.dart';
import 'package:meu_app/features/product_photo/domain/product_photo_generation_service.dart';

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
    final parameters = transport.payload?['parameters'] as Map<String, dynamic>;
    expect(parameters['common'], containsPair('productCategory', 'beverages'));
    expect(transport.payload.toString(), isNot(contains('imageBase64')));
  });

  test('preserva mensagem sanitizada em resposta HTTP de erro', () async {
    final service = HttpProductPhotoGenerationService(
      baseUrl: 'http://api.example',
      transport: _ResponseTransport(
        statusCode: 429,
        body: jsonEncode({'error': 'Serviço temporariamente indisponível.'}),
      ),
    );

    await expectLater(
      service.generateFour(_request()),
      throwsA(
        isA<ProductPhotoGenerationException>().having(
          (error) => error.message,
          'message',
          'Serviço temporariamente indisponível.',
        ),
      ),
    );
  });

  test('resposta JSON inválida produz erro controlado', () async {
    final service = HttpProductPhotoGenerationService(
      baseUrl: 'http://api.example',
      transport: const _ResponseTransport(statusCode: 200, body: '<html>'),
    );

    await expectLater(
      service.generateFour(_request()),
      throwsA(
        isA<ProductPhotoGenerationException>().having(
          (error) => error.message,
          'message',
          'O servidor retornou uma resposta inválida.',
        ),
      ),
    );
  });

  for (final failure in ImageHttpFailure.values) {
    test('$failure do transporte vira erro de domínio sanitizado', () async {
      final service = HttpProductPhotoGenerationService(
        baseUrl: 'http://api.example',
        transport: _FailingTransport(failure),
      );

      await expectLater(
        service.generateFour(_request()),
        throwsA(
          isA<ProductPhotoGenerationException>().having(
            (error) => error.message.contains('ProgressEvent'),
            'não expõe ProgressEvent',
            false,
          ),
        ),
      );
    });
  }
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
      productCategory: 'beverages',
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

class _ResponseTransport implements ImageHttpTransport {
  const _ResponseTransport({required this.statusCode, required this.body});

  final int statusCode;
  final String body;

  @override
  Future<ImageHttpResponse> postJson(Uri uri, String body) async =>
      (statusCode: statusCode, body: this.body);
}

class _FailingTransport implements ImageHttpTransport {
  const _FailingTransport(this.failure);

  final ImageHttpFailure failure;

  @override
  Future<ImageHttpResponse> postJson(Uri uri, String body) async {
    final message = switch (failure) {
      ImageHttpFailure.network => 'Não foi possível conectar ao servidor.',
      ImageHttpFailure.aborted => 'A geração foi cancelada.',
      ImageHttpFailure.timeout => 'A geração demorou demais.',
    };
    throw ImageHttpTransportException(failure, message);
  }
}
