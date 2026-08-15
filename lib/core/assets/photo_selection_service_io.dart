import 'photo_selection_service_base.dart';

PhotoSelectionService createPhotoSelectionService() =>
    _PendingNativePhotoSelectionService();

class _PendingNativePhotoSelectionService implements PhotoSelectionService {
  @override
  Future<SelectedPhoto?> selectImage() {
    throw const PhotoSelectionException(
      'A seleção de fotos neste dispositivo será ativada na integração nativa.',
    );
  }
}
