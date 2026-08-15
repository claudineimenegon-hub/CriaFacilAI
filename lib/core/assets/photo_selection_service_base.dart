import 'dart:typed_data';

class SelectedPhoto {
  const SelectedPhoto({required this.bytes, required this.mimeType});

  final Uint8List bytes;
  final String mimeType;
}

abstract interface class PhotoSelectionService {
  Future<SelectedPhoto?> selectImage();
}

class PhotoSelectionException implements Exception {
  const PhotoSelectionException(this.message);
  final String message;
}
