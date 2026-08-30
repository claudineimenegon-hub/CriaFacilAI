import 'dart:typed_data';

import '../../../core/generation/generation_request.dart';
import '../../../core/generation/generation_types.dart';

class CanonicalInventoryItem {
  const CanonicalInventoryItem({
    required this.id,
    required this.functionalType,
    required this.quantity,
  });
  final String id;
  final String functionalType;
  final int quantity;
}

class CanonicalIsolationResult {
  const CanonicalIsolationResult({
    required this.canonicalItemId,
    required this.asset,
    required this.isolationState,
    required this.isolationConfidence,
    required this.confirmable,
  });
  final String canonicalItemId;
  final AssetReference asset;
  final String isolationState;
  final double isolationConfidence;
  final bool confirmable;
}

abstract interface class CanonicalAssetIsolationClient {
  Future<CanonicalIsolationResult> isolateCanonicalAsset({
    required String analysisId,
    required String canonicalItemId,
    bool force = false,
  });
}

class CanonicalInventory {
  const CanonicalInventory({
    required this.analysisId,
    required this.items,
    required this.source,
  });
  final String analysisId;
  final List<CanonicalInventoryItem> items;
  final AssetReference source;
}

class CanonicalVisualAssetBinding {
  const CanonicalVisualAssetBinding({
    required this.canonicalItemId,
    required this.asset,
  });
  final String canonicalItemId;
  final AssetReference asset;

  Map<String, Object?> toJson() => {
    'canonicalItemId': canonicalItemId,
    'assetId': asset.id,
    'sourceKind': 'isolated_item',
    'isolationState': 'isolated',
    'isolationConfidence': 1.0,
    'userConfirmed': true,
    'mimeType': asset.mimeType,
    'width': asset.width,
    'height': asset.height,
    'sha256': asset.hash,
  };
}

class ExperimentalV3ImageResult {
  const ExperimentalV3ImageResult({
    required this.campaignRole,
    required this.status,
    this.imageBytes,
    this.errorMessage,
  });

  final String campaignRole;
  final String status;
  final Uint8List? imageBytes;
  final String? errorMessage;

  bool get isCompleted => status == 'completed' && imageBytes != null;
}

abstract interface class ExperimentalV3GenerationService {
  Future<CanonicalInventory> analyzeInventory(GenerationRequest request);

  Future<List<ExperimentalV3ImageResult>> generateFour(
    GenerationRequest request, {
    required String analysisId,
    required String quality,
    List<CanonicalVisualAssetBinding> canonicalVisualAssets = const [],
  });
}

class ExperimentalV3GenerationException implements Exception {
  const ExperimentalV3GenerationException(this.message);
  final String message;

  @override
  String toString() => message;
}
