enum AdObjective {
  venda('Vender agora'),
  lancamento('Lançamento'),
  promocao('Promoção'),
  atacado('Atacado / revenda'),
  engajamento('Engajamento');

  const AdObjective(this.label);
  final String label;
}

enum AdTone {
  luxo('Luxo'),
  elegante('Elegante'),
  divertido('Divertido'),
  urgente('Urgente'),
  proximo('Próximo');

  const AdTone(this.label);
  final String label;
}

enum AdPlatform {
  instagram('Instagram'),
  facebook('Facebook'),
  tiktok('TikTok'),
  whatsapp('WhatsApp'),
  loja('Loja');

  const AdPlatform(this.label);
  final String label;

  static AdPlatform? fromName(String name) {
    for (final value in values) {
      if (value.name == name) return value;
    }
    return null;
  }
}

class AdCopyRequest {
  const AdCopyRequest({
    required this.productName,
    required this.objective,
    required this.tone,
    required this.platforms,
    this.price = '',
    this.details = '',
    this.offer = '',
    this.brandName = '',
    this.contact = '',
    this.variants = 2,
    this.inputAssetIds = const [],
  });

  final String productName;
  final String price;
  final String details;
  final String offer;
  final String brandName;
  final String contact;
  final AdObjective objective;
  final AdTone tone;
  final Set<AdPlatform> platforms;
  final int variants;
  final List<String> inputAssetIds;

  Map<String, Object?> toJson() => {
    'product': {
      'name': productName,
      'price': price,
      'details': details,
      'offer': offer,
    },
    'brandName': brandName,
    'contact': contact,
    'objective': objective.name,
    'tone': tone.name,
    'platforms': platforms.map((p) => p.name).toList(),
    'variants': variants,
    'inputAssetIds': inputAssetIds,
  };
}

List<String> _strings(Object? value) => switch (value) {
  final List<dynamic> list => list.whereType<String>().toList(growable: false),
  _ => const <String>[],
};

String _string(Object? value) => value is String ? value : '';

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

class AdCopyVariant {
  const AdCopyVariant({
    required this.angle,
    required this.headline,
    required this.caption,
    required this.cta,
    required this.hashtags,
  });

  factory AdCopyVariant.fromJson(Map<String, dynamic> json) => AdCopyVariant(
    angle: _string(json['angle']),
    headline: _string(json['headline']),
    caption: _string(json['caption']),
    cta: _string(json['cta']),
    hashtags: _strings(json['hashtags']),
  );

  final String angle;
  final String headline;
  final String caption;
  final String cta;
  final List<String> hashtags;

  /// Texto pronto para colar na rede social.
  String get fullText => [
    if (headline.isNotEmpty) headline,
    if (caption.isNotEmpty) caption,
    if (cta.isNotEmpty) cta,
    if (hashtags.isNotEmpty) hashtags.join(' '),
  ].join('\n\n');
}

class AdCopyPlatformResult {
  const AdCopyPlatformResult({
    required this.platform,
    required this.label,
    required this.variants,
  });

  factory AdCopyPlatformResult.fromJson(Map<String, dynamic> json) {
    final name = _string(json['platform']);
    return AdCopyPlatformResult(
      platform: AdPlatform.fromName(name),
      label: AdPlatform.fromName(name)?.label ?? _string(json['label']),
      variants: (json['variants'] as List<dynamic>? ?? const [])
          .map((v) => AdCopyVariant.fromJson(_map(v)))
          .toList(growable: false),
    );
  }

  final AdPlatform? platform;
  final String label;
  final List<AdCopyVariant> variants;
}

class AdCopyWarning {
  const AdCopyWarning({required this.where, required this.message});
  final String where;
  final String message;
}

class AdCopyResult {
  const AdCopyResult({
    required this.whatItIs,
    required this.emotions,
    required this.idealCustomer,
    required this.platforms,
    required this.descriptionTitle,
    required this.descriptionShort,
    required this.descriptionLong,
    required this.descriptionBullets,
    required this.imageTextIdeas,
    required this.warnings,
  });

  factory AdCopyResult.fromJson(Map<String, dynamic> json) {
    final reading = _map(json['productReading']);
    final description = _map(json['productDescription']);
    final review = _map(json['review']);
    return AdCopyResult(
      whatItIs: _string(reading['whatItIs']),
      emotions: _strings(reading['emotions']),
      idealCustomer: _string(reading['idealCustomer']),
      platforms: (json['platforms'] as List<dynamic>? ?? const [])
          .map((p) => AdCopyPlatformResult.fromJson(_map(p)))
          .where((p) => p.variants.isNotEmpty)
          .toList(growable: false),
      descriptionTitle: _string(description['title']),
      descriptionShort: _string(description['short']),
      descriptionLong: _string(description['long']),
      descriptionBullets: _strings(description['bullets']),
      imageTextIdeas: _strings(json['imageTextIdeas']),
      warnings: (review['warnings'] as List<dynamic>? ?? const [])
          .map(_map)
          .map(
            (w) => AdCopyWarning(
              where: _string(w['where']),
              message: _string(w['message']),
            ),
          )
          .toList(growable: false),
    );
  }

  final String whatItIs;
  final List<String> emotions;
  final String idealCustomer;
  final List<AdCopyPlatformResult> platforms;
  final String descriptionTitle;
  final String descriptionShort;
  final String descriptionLong;
  final List<String> descriptionBullets;
  final List<String> imageTextIdeas;
  final List<AdCopyWarning> warnings;

  String get fullDescription => [
    descriptionTitle,
    descriptionShort,
    descriptionLong,
    if (descriptionBullets.isNotEmpty)
      descriptionBullets.map((b) => '• $b').join('\n'),
  ].where((part) => part.isNotEmpty).join('\n\n');
}

abstract interface class AdCopyService {
  Future<AdCopyResult> generate(AdCopyRequest request);
}

class AdCopyException implements Exception {
  const AdCopyException(this.message);
  final String message;

  @override
  String toString() => message;
}
