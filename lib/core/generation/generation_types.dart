enum GenerationOperation {
  textToImage,
  imageToImage,
  imageEdit,
  background,
  upscale,
  textToVideo,
  imageToVideo,
  videoToVideo,
}

enum GenerationQuality { standard, pro, ultra }

enum AssetMediaType { image, video }

enum AssetRole {
  product,
  person,
  styleReference,
  compositionReference,
  mask,
  baseImage,
  baseVideo,
}

enum AssetRetentionPolicy { temporary, project }

enum OutputFormat { png, jpeg, webp, mp4 }

class AssetReference {
  const AssetReference({
    required this.id,
    required this.mediaType,
    required this.mimeType,
    required this.role,
    required this.width,
    required this.height,
    required this.retentionPolicy,
    this.duration,
    this.hash,
    this.temporaryUrl,
    this.internalReference,
    this.expiresAt,
  }) : assert(temporaryUrl != null || internalReference != null);

  final String id;
  final AssetMediaType mediaType;
  final String mimeType;
  final AssetRole role;
  final int width;
  final int height;
  final Duration? duration;
  final String? hash;
  final String? temporaryUrl;
  final String? internalReference;
  final AssetRetentionPolicy retentionPolicy;
  final DateTime? expiresAt;

  Map<String, Object?> toJson() => {
    'id': id,
    'mediaType': mediaType.name,
    'mimeType': mimeType,
    'role': role.name,
    'width': width,
    'height': height,
    if (duration != null) 'durationMs': duration!.inMilliseconds,
    if (hash != null) 'hash': hash,
    if (temporaryUrl != null) 'temporaryUrl': temporaryUrl,
    if (internalReference != null) 'internalReference': internalReference,
    'retentionPolicy': retentionPolicy.name,
    if (expiresAt != null) 'expiresAt': expiresAt!.toUtc().toIso8601String(),
  };

  factory AssetReference.fromJson(Map<String, dynamic> json) {
    return AssetReference(
      id: json['id'] as String,
      mediaType: AssetMediaType.values.byName(json['mediaType'] as String),
      mimeType: json['mimeType'] as String,
      role: AssetRole.values.byName(json['role'] as String),
      width: json['width'] as int,
      height: json['height'] as int,
      duration: switch (json['durationMs']) {
        final int value => Duration(milliseconds: value),
        _ => null,
      },
      hash: json['hash'] as String?,
      temporaryUrl: json['temporaryUrl'] as String?,
      internalReference: json['internalReference'] as String?,
      retentionPolicy: AssetRetentionPolicy.values.byName(
        json['retentionPolicy'] as String,
      ),
      expiresAt: switch (json['expiresAt']) {
        final String value => DateTime.parse(value),
        _ => null,
      },
    );
  }
}

class ProtectedRegion {
  const ProtectedRegion({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  }) : assert(x >= 0 && x <= 1),
       assert(y >= 0 && y <= 1),
       assert(width > 0 && width <= 1),
       assert(height > 0 && height <= 1);

  final double x;
  final double y;
  final double width;
  final double height;

  Map<String, double> toJson() => {
    'x': x,
    'y': y,
    'width': width,
    'height': height,
  };
}

class PreservationOptions {
  const PreservationOptions({
    this.preserveProduct = false,
    this.preservePackaging = false,
    this.preserveLabel = false,
    this.preservePrintedText = false,
    this.preserveLogo = false,
    this.preserveFace = false,
    this.preserveClothing = false,
    this.preserveColors = false,
    this.preserveProportions = false,
    this.changeBackgroundOnly = false,
    this.changeLightingOnly = false,
    this.changeSceneOnly = false,
    this.preservationStrength = 1,
    this.protectedRegion,
    this.maskReference,
    this.colorTolerance = 0,
  }) : assert(preservationStrength >= 0 && preservationStrength <= 1),
       assert(colorTolerance >= 0 && colorTolerance <= 1);

  final bool preserveProduct;
  final bool preservePackaging;
  final bool preserveLabel;
  final bool preservePrintedText;
  final bool preserveLogo;
  final bool preserveFace;
  final bool preserveClothing;
  final bool preserveColors;
  final bool preserveProportions;
  final bool changeBackgroundOnly;
  final bool changeLightingOnly;
  final bool changeSceneOnly;
  final double preservationStrength;
  final ProtectedRegion? protectedRegion;
  final AssetReference? maskReference;
  final double colorTolerance;

  Map<String, Object?> toJson() => {
    'preserveProduct': preserveProduct,
    'preservePackaging': preservePackaging,
    'preserveLabel': preserveLabel,
    'preservePrintedText': preservePrintedText,
    'preserveLogo': preserveLogo,
    'preserveFace': preserveFace,
    'preserveClothing': preserveClothing,
    'preserveColors': preserveColors,
    'preserveProportions': preserveProportions,
    'changeBackgroundOnly': changeBackgroundOnly,
    'changeLightingOnly': changeLightingOnly,
    'changeSceneOnly': changeSceneOnly,
    'preservationStrength': preservationStrength,
    if (protectedRegion != null) 'protectedRegion': protectedRegion!.toJson(),
    if (maskReference != null) 'maskReference': maskReference!.toJson(),
    'colorTolerance': colorTolerance,
  };
}
