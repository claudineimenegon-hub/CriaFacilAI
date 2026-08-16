// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;

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
    final reader = html.FileReader();
    final completed = reader.onLoad.first.then((_) => true);
    final failed = reader.onError.first.then<bool>((_) {
      throw const PhotoSelectionException(
        'Não foi possível ler esta foto.',
        stage: 'file_reader',
        exceptionType: 'FileReaderError',
      );
    });
    final aborted = reader.onAbort.first.then<bool>((_) {
      throw const PhotoSelectionException(
        'A leitura da foto foi cancelada.',
        stage: 'file_reader',
        exceptionType: 'FileReaderAbort',
      );
    });
    reader.readAsArrayBuffer(file);
    try {
      await Future.any([completed, failed, aborted]);
    } on PhotoSelectionException {
      rethrow;
    } catch (error) {
      throw PhotoSelectionException(
        'Não foi possível ler esta foto.',
        stage: 'file_reader',
        exceptionType: error.runtimeType.toString(),
      );
    }
    return selectedPhotoFromReaderResult(
      result: reader.result,
      browserMimeType: file.type,
      fileName: file.name,
    );
  }
}
