// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:async';
import 'dart:html' as html;
import 'dart:js_util' as js_util;

import 'image_share_service_base.dart';

ImageShareService createImageShareService() => _WebImageShareService();

class _WebImageShareService implements ImageShareService {
  html.File _toFile(ShareableImage image) => html.File(
    [image.bytes],
    image.fullFileName,
    {'type': image.mimeType},
  );

  @override
  bool get canShareFiles {
    final navigator = html.window.navigator;
    if (!js_util.hasProperty(navigator, 'share') ||
        !js_util.hasProperty(navigator, 'canShare')) {
      return false;
    }
    try {
      final probe = html.File([<int>[0x89, 0x50, 0x4e, 0x47]], 'teste.png', {'type': 'image/png'});
      return js_util.callMethod<bool>(navigator, 'canShare', [
        js_util.jsify({'files': [probe]}),
      ]);
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> download(ShareableImage image) async {
    final blob = html.Blob([image.bytes], image.mimeType);
    final url = html.Url.createObjectUrlFromBlob(blob);
    final anchor = html.AnchorElement(href: url)
      ..download = image.fullFileName
      ..style.display = 'none';
    html.document.body?.append(anchor);
    anchor.click();
    anchor.remove();
    // Dá tempo ao navegador de iniciar o download antes de liberar a memória.
    Timer(const Duration(seconds: 30), () => html.Url.revokeObjectUrl(url));
  }

  @override
  Future<bool> share(List<ShareableImage> images, {String? text}) async {
    if (!canShareFiles) {
      throw const ImageShareException(
        'Este navegador não permite compartilhar fotos. Use o botão Baixar.',
      );
    }
    final data = <String, Object>{
      'files': images.map(_toFile).toList(),
      if (text != null && text.isNotEmpty) 'text': text,
    };
    final jsData = js_util.jsify(data);
    final navigator = html.window.navigator;
    if (!js_util.callMethod<bool>(navigator, 'canShare', [jsData])) {
      throw const ImageShareException(
        'Não foi possível compartilhar estas fotos. Use o botão Baixar.',
      );
    }
    try {
      await js_util.promiseToFuture<void>(
        js_util.callMethod<Object>(navigator, 'share', [jsData]),
      );
      return true;
    } catch (error) {
      // AbortError = usuário fechou a janela de compartilhar.
      if (error.toString().contains('AbortError')) return false;
      throw const ImageShareException('Não foi possível compartilhar agora.');
    }
  }
}
