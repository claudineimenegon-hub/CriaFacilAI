import 'image_share_service_base.dart';

ImageShareService createImageShareService() => _UnsupportedImageShareService();

class _UnsupportedImageShareService implements ImageShareService {
  @override
  bool get canShareFiles => false;

  @override
  Future<void> download(ShareableImage image) async {
    throw const ImageShareException(
      'Baixar fotos está disponível na versão web do app.',
    );
  }

  @override
  Future<bool> share(List<ShareableImage> images, {String? text}) async {
    throw const ImageShareException(
      'Compartilhar fotos está disponível na versão web do app.',
    );
  }
}
