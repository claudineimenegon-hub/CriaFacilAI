import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/features/image/data/http_image_generation_service.dart';
import 'package:meu_app/features/image/data/http_transport.dart';

void main() {
  test('geração singular envia count=1 e aceita contrato compatível', () async {
    final transport = _FakeTransport({
      'imageBase64': base64Encode([1, 2, 3]),
    });
    final service = HttpImageGenerationService(
      baseUrl: 'http://api.example',
      transport: transport,
    );

    final image = await service.generate(prompt: 'imagem singular');

    expect(image, [1, 2, 3]);
    expect(transport.lastPayload, {'prompt': 'imagem singular', 'count': 1});
  });

  test('geração múltipla envia count=4 e decodifica quatro imagens', () async {
    final encodedImages = List.generate(
      4,
      (index) => base64Encode([index + 1]),
    );
    final transport = _FakeTransport({
      'imageBase64': encodedImages.first,
      'imagesBase64': encodedImages,
    });
    final service = HttpImageGenerationService(
      baseUrl: 'http://api.example',
      transport: transport,
    );

    final images = await service.generateMany(prompt: 'quatro logos', count: 4);

    expect(images.map((image) => image.single), [1, 2, 3, 4]);
    expect(transport.lastPayload, {'prompt': 'quatro logos', 'count': 4});
  });
}

class _FakeTransport implements ImageHttpTransport {
  _FakeTransport(this.responsePayload);

  final Map<String, Object> responsePayload;
  Map<String, dynamic>? lastPayload;

  @override
  Future<ImageHttpResponse> postJson(Uri uri, String body) async {
    lastPayload = jsonDecode(body) as Map<String, dynamic>;
    return (statusCode: 200, body: jsonEncode(responsePayload));
  }
}
