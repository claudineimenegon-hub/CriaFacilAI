import 'generation_request.dart';
import 'generation_types.dart';

enum GenerationBatchStatus { pending, completed, failed }

enum GenerationJobStatus { queued, running, completed, failed, cancelled }

class GeneratedAsset {
  const GeneratedAsset({
    required this.id,
    required this.mediaType,
    required this.reference,
    this.thumbnail,
    required this.width,
    required this.height,
    this.duration,
    required this.createdAt,
    this.expiresAt,
    required this.requestedQuality,
    this.technicalMetadata = const {},
    this.sourceAssetIds = const [],
    required this.effectivePrompt,
    required this.effectiveParameters,
    this.fidelityMetadata,
  });

  final String id;
  final AssetMediaType mediaType;
  final String reference;
  final String? thumbnail;
  final int width;
  final int height;
  final Duration? duration;
  final DateTime createdAt;
  final DateTime? expiresAt;
  final GenerationQuality requestedQuality;
  final Map<String, Object?> technicalMetadata;
  final List<String> sourceAssetIds;
  final String effectivePrompt;
  final GenerationParameters effectiveParameters;
  final Map<String, Object?>? fidelityMetadata;
}

class GenerationBatch {
  const GenerationBatch({
    required this.id,
    this.expectedCount = 4,
    this.assets = const [],
    required this.variationStrategy,
    required this.status,
    this.totalCostMetadata,
    this.failureReason,
  }) : assert(expectedCount == 4),
       assert(status != GenerationBatchStatus.completed || assets.length == 4);

  final String id;
  final int expectedCount;
  final List<GeneratedAsset> assets;
  final String variationStrategy;
  final GenerationBatchStatus status;
  final Map<String, Object?>? totalCostMetadata;
  final String? failureReason;
}

class GenerationJob {
  const GenerationJob({
    required this.id,
    required this.status,
    required this.progress,
    required this.attempts,
    required this.timeout,
    required this.createdAt,
    this.startedAt,
    this.completedAt,
    this.batch,
    this.result,
    this.sanitizedError,
  }) : assert(progress >= 0 && progress <= 1),
       assert(attempts >= 0);

  final String id;
  final GenerationJobStatus status;
  final double progress;
  final int attempts;
  final Duration timeout;
  final DateTime createdAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final GenerationBatch? batch;
  final GeneratedAsset? result;
  final String? sanitizedError;
}
