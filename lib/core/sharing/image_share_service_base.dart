import 'dart:typed_data';

class ShareableImage {
  const ShareableImage({required this.bytes, required this.fileName});

  final Uint8List bytes;
  final String fileName;

  /// Detecta o tipo pela assinatura do arquivo.
  String get mimeType {
    final b = bytes;
    if (b.length >= 4 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4e && b[3] == 0x47) {
      return 'image/png';
    }
    if (b.length >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff) {
      return 'image/jpeg';
    }
    if (b.length >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 &&
        b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) {
      return 'image/webp';
    }
    return 'image/png';
  }

  String get extension => switch (mimeType) {
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
    _ => 'png',
  };

  String get fullFileName => '$fileName.$extension';
}

abstract interface class ImageShareService {
  /// Se o aparelho permite compartilhar arquivos (WhatsApp, Instagram...).
  bool get canShareFiles;

  Future<void> download(ShareableImage image);

  /// Compartilha uma ou mais imagens. Retorna false se o usuário cancelar.
  Future<bool> share(List<ShareableImage> images, {String? text});
}

class ImageShareException implements Exception {
  const ImageShareException(this.message);
  final String message;

  @override
  String toString() => message;
}
