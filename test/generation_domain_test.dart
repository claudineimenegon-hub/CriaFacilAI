import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/generation/generation_request.dart';
import 'package:meu_app/core/generation/generation_result.dart';
import 'package:meu_app/core/generation/generation_types.dart';

void main() {
  final expiresAt = DateTime.utc(2026, 8, 15, 12);
  final asset = AssetReference(
    id: 'asset-1',
    mediaType: AssetMediaType.image,
    mimeType: 'image/png',
    role: AssetRole.product,
    width: 800,
    height: 600,
    hash: 'hash-seguro',
    temporaryUrl: 'http://localhost/v1/assets/images/asset-1',
    retentionPolicy: AssetRetentionPolicy.temporary,
    expiresAt: expiresAt,
  );

  test('AssetReference preserva metadados e política de expiração', () {
    final restored = AssetReference.fromJson(asset.toJson());

    expect(restored.id, asset.id);
    expect(restored.role, AssetRole.product);
    expect(restored.width, 800);
    expect(restored.height, 600);
    expect(restored.hash, 'hash-seguro');
    expect(restored.expiresAt, expiresAt);
    expect(restored.retentionPolicy, AssetRetentionPolicy.temporary);
  });

  test('PreservationOptions serializa proteções comerciais', () {
    const options = PreservationOptions(
      preserveProduct: true,
      preservePackaging: true,
      preserveLabel: true,
      preservePrintedText: true,
      preserveLogo: true,
      preserveColors: true,
      preserveProportions: true,
      changeBackgroundOnly: true,
      preservationStrength: 0.95,
      colorTolerance: 0.05,
    );

    expect(options.toJson(), containsPair('preserveProduct', true));
    expect(options.toJson(), containsPair('preservePrintedText', true));
    expect(options.toJson(), containsPair('changeBackgroundOnly', true));
    expect(options.toJson(), containsPair('preservationStrength', 0.95));
  });

  test('GenerationRequest reúne operação, entrada e quatro saídas', () {
    final request = GenerationRequest(
      operation: GenerationOperation.imageToImage,
      prompt: 'Campanha premium',
      inputs: [asset],
      preservationOptions: const PreservationOptions(preserveProduct: true),
      generationParameters: const GenerationParameters(
        common: CommonGenerationParameters(
          aspectRatio: '4:5',
          resolution: '1024x1280',
          outputFormat: OutputFormat.png,
        ),
        image: ImageGenerationParameters(lighting: 'studio'),
      ),
      outputSpecification: const OutputSpecification.fourImages(
        aspectRatio: '4:5',
        resolution: '1024x1280',
      ),
      idempotencyKey: 'request-1',
    );

    final json = request.toJson();
    expect(json['contractVersion'], '1.0');
    expect(json['operation'], 'imageToImage');
    expect((json['inputs'] as List), hasLength(1));
    expect((json['outputSpecification'] as Map<String, Object>)['count'], 4);
  });

  test('GenerationBatch assume exatamente quatro propostas', () {
    const batch = GenerationBatch(
      id: 'batch-1',
      variationStrategy: 'commercial-directions-v1',
      status: GenerationBatchStatus.pending,
    );

    expect(batch.expectedCount, 4);
    expect(batch.assets, isEmpty);
    expect(batch.status, GenerationBatchStatus.pending);
  });
}
