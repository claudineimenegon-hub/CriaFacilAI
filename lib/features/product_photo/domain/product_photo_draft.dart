import '../../../core/generation/generation_request.dart';
import '../../../core/generation/generation_types.dart';

enum ProductCategory {
  general('Produto geral'),
  food('Alimentos'),
  beverages('Bebidas'),
  clothing('Roupas'),
  jewelry('Joias'),
  cosmetics('Cosméticos'),
  electronics('Eletrônicos'),
  automotive('Automóveis'),
  person('Pessoa'),
  environment('Ambiente');

  const ProductCategory(this.label);
  final String label;
}

enum ProductVisualObjective {
  premiumStudio('Estúdio Premium'),
  lifestyle('Lifestyle'),
  luxury('Luxo'),
  ecommerce('E-commerce'),
  cinematic('Cinematográfico'),
  socialMedia('Social Media');

  const ProductVisualObjective(this.label);
  final String label;
}

class ProductPhotoDraft {
  const ProductPhotoDraft({
    required this.asset,
    required this.category,
    required this.objective,
    required this.description,
    required this.aspectRatio,
    required this.preservationOptions,
  });

  final AssetReference asset;
  final ProductCategory category;
  final ProductVisualObjective objective;
  final String description;
  final String aspectRatio;
  final PreservationOptions preservationOptions;

  GenerationRequest buildRequest({required String idempotencyKey}) {
    final resolution = switch (aspectRatio) {
      '4:5' => '1024x1280',
      '9:16' => '1024x1820',
      '16:9' => '1820x1024',
      _ => '1024x1024',
    };
    final role = category == ProductCategory.person
        ? AssetRole.person
        : AssetRole.product;
    return GenerationRequest(
      operation: GenerationOperation.imageToImage,
      prompt: [
        'Crie uma imagem publicitária premium para ${category.label.toLowerCase()}.',
        'Objetivo visual: ${objective.label}.',
        if (description.trim().isNotEmpty) description.trim(),
      ].join(' '),
      inputs: [_assetWithRole(asset, role)],
      preservationOptions: preservationOptions,
      generationParameters: GenerationParameters(
        common: CommonGenerationParameters(
          aspectRatio: aspectRatio,
          resolution: resolution,
          outputFormat: OutputFormat.png,
          creativeStrength: 0.6,
          referenceStrength: 1,
          artisticDirection: objective.label,
        ),
        image: const ImageGenerationParameters(),
      ),
      outputSpecification: OutputSpecification.fourImages(
        aspectRatio: aspectRatio,
        resolution: resolution,
      ),
      idempotencyKey: idempotencyKey,
    );
  }

  static AssetReference _assetWithRole(AssetReference asset, AssetRole role) {
    return AssetReference(
      id: asset.id,
      mediaType: asset.mediaType,
      mimeType: asset.mimeType,
      role: role,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      hash: asset.hash,
      temporaryUrl: asset.temporaryUrl,
      internalReference: asset.internalReference,
      retentionPolicy: asset.retentionPolicy,
      expiresAt: asset.expiresAt,
    );
  }
}
