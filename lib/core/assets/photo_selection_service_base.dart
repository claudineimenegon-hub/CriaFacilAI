import 'dart:typed_data';

class SelectedPhoto {
  const SelectedPhoto({
    required this.bytes,
    required this.mimeType,
    this.fileName = '',
  });

  final Uint8List bytes;
  final String mimeType;
  final String fileName;
}

abstract interface class PhotoSelectionService {
  Future<SelectedPhoto?> selectImage();
}

class PhotoSelectionException implements Exception {
  const PhotoSelectionException(
    this.message, {
    this.stage = 'selection',
    this.exceptionType = 'PhotoSelectionException',
  });

  final String message;
  final String stage;
  final String exceptionType;
}

String? detectSupportedImageMime(Uint8List bytes) {
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4e &&
      bytes[3] == 0x47 &&
      bytes[4] == 0x0d &&
      bytes[5] == 0x0a &&
      bytes[6] == 0x1a &&
      bytes[7] == 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 &&
      bytes[0] == 0xff &&
      bytes[1] == 0xd8 &&
      bytes[2] == 0xff) {
    return 'image/jpeg';
  }
  return null;
}

SelectedPhoto selectedPhotoFromReaderResult({
  required Object? result,
  required String browserMimeType,
  required String fileName,
}) {
  final Uint8List bytes;
  if (result is Uint8List) {
    bytes = result;
  } else if (result is ByteBuffer) {
    bytes = result.asUint8List();
  } else {
    throw PhotoSelectionException(
      'Não foi possível ler esta foto.',
      stage: 'array_buffer_conversion',
      exceptionType: result.runtimeType.toString(),
    );
  }
  if (bytes.isEmpty) {
    throw const PhotoSelectionException(
      'A foto selecionada está vazia.',
      stage: 'byte_validation',
      exceptionType: 'EmptyFile',
    );
  }
  final detectedMimeType = detectSupportedImageMime(bytes);
  if (detectedMimeType == null) {
    throw const PhotoSelectionException(
      'Selecione uma imagem PNG ou JPEG válida.',
      stage: 'signature_validation',
      exceptionType: 'UnsupportedImageSignature',
    );
  }
  return SelectedPhoto(
    bytes: bytes,
    mimeType: detectedMimeType,
    fileName: fileName,
  );
}
