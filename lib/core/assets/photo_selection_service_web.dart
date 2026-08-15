// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;
import 'dart:typed_data';

import 'photo_selection_service_base.dart';

PhotoSelectionService createPhotoSelectionService() =>
    _WebPhotoSelectionService();

class _WebPhotoSelectionService implements PhotoSelectionService {
  @override
  Future<SelectedPhoto?> selectImage() async {
    final input = html.FileUploadInputElement()
      ..accept = 'image/png,image/jpeg';
    input.click();
    await input.onChange.first;
    final files = input.files;
    if (files == null || files.isEmpty) return null;
    final file = files.first;
    final reader = html.FileReader()..readAsArrayBuffer(file);
    await reader.onLoad.first;
    final result = reader.result;
    if (result is! ByteBuffer) {
      throw const PhotoSelectionException('Não foi possível ler esta foto.');
    }
    return SelectedPhoto(bytes: result.asUint8List(), mimeType: file.type);
  }
}
