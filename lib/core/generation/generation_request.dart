import 'generation_types.dart';

class CommonGenerationParameters {
  const CommonGenerationParameters({
    required this.aspectRatio,
    required this.resolution,
    required this.outputFormat,
    this.creativeStrength = 0.5,
    this.referenceStrength = 1,
    this.artisticDirection,
    this.productCategory,
  }) : assert(creativeStrength >= 0 && creativeStrength <= 1),
       assert(referenceStrength >= 0 && referenceStrength <= 1);

  final String aspectRatio;
  final String resolution;
  final OutputFormat outputFormat;
  final double creativeStrength;
  final double referenceStrength;
  final String? artisticDirection;
  final String? productCategory;

  Map<String, Object?> toJson() => {
    'aspectRatio': aspectRatio,
    'resolution': resolution,
    'outputFormat': outputFormat.name,
    'creativeStrength': creativeStrength,
    'referenceStrength': referenceStrength,
    if (artisticDirection != null) 'artisticDirection': artisticDirection,
    if (productCategory != null) 'productCategory': productCategory,
  };
}

class ImageGenerationParameters {
  const ImageGenerationParameters({
    this.camera,
    this.lens,
    this.framing,
    this.lighting,
    this.depthOfField,
  });

  final String? camera;
  final String? lens;
  final String? framing;
  final String? lighting;
  final String? depthOfField;

  Map<String, Object?> toJson() => {
    if (camera != null) 'camera': camera,
    if (lens != null) 'lens': lens,
    if (framing != null) 'framing': framing,
    if (lighting != null) 'lighting': lighting,
    if (depthOfField != null) 'depthOfField': depthOfField,
  };
}

class VideoGenerationParameters {
  const VideoGenerationParameters({
    required this.duration,
    required this.fps,
    this.cameraMovement,
    this.movementIntensity = 0.5,
  }) : assert(fps > 0),
       assert(movementIntensity >= 0 && movementIntensity <= 1);

  final Duration duration;
  final int fps;
  final String? cameraMovement;
  final double movementIntensity;

  Map<String, Object?> toJson() => {
    'durationMs': duration.inMilliseconds,
    'fps': fps,
    if (cameraMovement != null) 'cameraMovement': cameraMovement,
    'movementIntensity': movementIntensity,
  };
}

class GenerationParameters {
  const GenerationParameters({required this.common, this.image, this.video})
    : assert(image == null || video == null);

  final CommonGenerationParameters common;
  final ImageGenerationParameters? image;
  final VideoGenerationParameters? video;

  Map<String, Object?> toJson() => {
    'common': common.toJson(),
    if (image != null) 'image': image!.toJson(),
    if (video != null) 'video': video!.toJson(),
  };
}

class OutputSpecification {
  const OutputSpecification({
    required this.count,
    required this.mediaType,
    required this.aspectRatio,
    required this.resolution,
    required this.format,
    required this.quality,
  }) : assert(count > 0);

  const OutputSpecification.fourImages({
    this.aspectRatio = '1:1',
    this.resolution = '1024x1024',
    this.format = OutputFormat.png,
    this.quality = GenerationQuality.standard,
  }) : count = 4,
       mediaType = AssetMediaType.image;

  final int count;
  final AssetMediaType mediaType;
  final String aspectRatio;
  final String resolution;
  final OutputFormat format;
  final GenerationQuality quality;

  Map<String, Object> toJson() => {
    'count': count,
    'mediaType': mediaType.name,
    'aspectRatio': aspectRatio,
    'resolution': resolution,
    'format': format.name,
    'quality': quality.name,
  };
}

class GenerationRequest {
  const GenerationRequest({
    this.contractVersion = '1.0',
    required this.operation,
    required this.prompt,
    this.negativePrompt,
    this.inputs = const [],
    required this.preservationOptions,
    required this.generationParameters,
    required this.outputSpecification,
    this.templateId,
    required this.idempotencyKey,
  });

  final String contractVersion;
  final GenerationOperation operation;
  final String prompt;
  final String? negativePrompt;
  final List<AssetReference> inputs;
  final PreservationOptions preservationOptions;
  final GenerationParameters generationParameters;
  final OutputSpecification outputSpecification;
  final String? templateId;
  final String idempotencyKey;

  Map<String, Object?> toJson() => {
    'contractVersion': contractVersion,
    'operation': operation.name,
    'prompt': prompt,
    if (negativePrompt != null) 'negativePrompt': negativePrompt,
    'inputs': inputs.map((asset) => asset.toJson()).toList(growable: false),
    'preservationOptions': preservationOptions.toJson(),
    'generationParameters': generationParameters.toJson(),
    'outputSpecification': outputSpecification.toJson(),
    if (templateId != null) 'templateId': templateId,
    'idempotencyKey': idempotencyKey,
  };
}
