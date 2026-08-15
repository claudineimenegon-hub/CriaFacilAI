import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/generation/generation_types.dart';
import 'package:meu_app/features/product_photo/domain/product_photo_draft.dart';

void main() {
  test('constrói requisição de Foto Publicitária com quatro propostas', () {
    final draft = ProductPhotoDraft(
      asset: AssetReference(
        id: 'asset-product',
        mediaType: AssetMediaType.image,
        mimeType: 'image/jpeg',
        role: AssetRole.product,
        width: 1200,
        height: 1200,
        internalReference: 'asset:asset-product',
        retentionPolicy: AssetRetentionPolicy.temporary,
      ),
      category: ProductCategory.beverages,
      objective: ProductVisualObjective.premiumStudio,
      description: 'Luz lateral sofisticada',
      aspectRatio: '4:5',
      preservationOptions: const PreservationOptions(
        preserveProduct: true,
        preservePackaging: true,
        preserveLabel: true,
        preserveColors: true,
      ),
    );

    final request = draft.buildRequest(idempotencyKey: 'photo-request-1');

    expect(request.operation, GenerationOperation.imageToImage);
    expect(request.inputs, hasLength(1));
    expect(request.inputs.single.role, AssetRole.product);
    expect(request.prompt, contains('bebidas'));
    expect(request.prompt, contains('Estúdio Premium'));
    expect(request.outputSpecification.count, 4);
    expect(request.outputSpecification.aspectRatio, '4:5');
    expect(request.preservationOptions.preserveLabel, isTrue);
  });

  test('categoria pessoa atribui papel person à referência', () {
    final request = ProductPhotoDraft(
      asset: AssetReference(
        id: 'asset-person',
        mediaType: AssetMediaType.image,
        mimeType: 'image/png',
        role: AssetRole.product,
        width: 600,
        height: 800,
        internalReference: 'asset:asset-person',
        retentionPolicy: AssetRetentionPolicy.temporary,
      ),
      category: ProductCategory.person,
      objective: ProductVisualObjective.lifestyle,
      description: '',
      aspectRatio: '9:16',
      preservationOptions: const PreservationOptions(preserveFace: true),
    ).buildRequest(idempotencyKey: 'person-request-1');

    expect(request.inputs.single.role, AssetRole.person);
    expect(request.outputSpecification.count, 4);
  });
}
