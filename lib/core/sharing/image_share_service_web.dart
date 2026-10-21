import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

import 'image_share_service_base.dart';

ImageShareService createImageShareService() => _WebImageShareService();

JSObject get _navigator => globalContext['navigator'] as JSObject;

JSObject _newJs(String constructor, List<JSAny?> args) =>
    (globalContext[constructor] as JSFunction).callAsConstructorVarArgs<JSObject>(args);

JSObject _options(Map<String, JSAny?> values) {
  final object = JSObject();
  values.forEach((key, value) => object[key] = value);
  return object;
}

JSObject _toFile(ShareableImage image) => _newJs('File', [
  [image.bytes.toJS].toJS,
  image.fullFileName.toJS,
  _options({'type': image.mimeType.toJS}),
]);

class _WebImageShareService implements ImageShareService {
  bool _canShare(JSObject data) {
    try {
      final result = _navigator.callMethod<JSAny?>('canShare'.toJS, data);
      return result is JSBoolean && result.toDart;
    } catch (_) {
      return false;
    }
  }

  @override
  bool get canShareFiles {
    if (!_navigator.has('share') || !_navigator.has('canShare')) return false;
    final probe = _toFile(
      ShareableImage(
        bytes: Uint8List.fromList(const [0x89, 0x50, 0x4e, 0x47]),
        fileName: 'teste',
      ),
    );
    return _canShare(_options({'files': [probe].toJS}));
  }

  @override
  Future<void> download(ShareableImage image) async {
    final blob = _newJs('Blob', [
      [image.bytes.toJS].toJS,
      _options({'type': image.mimeType.toJS}),
    ]);
    final urlApi = globalContext['URL'] as JSObject;
    final url = urlApi.callMethod<JSString>('createObjectURL'.toJS, blob);
    final document = globalContext['document'] as JSObject;
    final anchor = document.callMethod<JSObject>('createElement'.toJS, 'a'.toJS);
    anchor['href'] = url;
    anchor['download'] = image.fullFileName.toJS;
    (anchor['style'] as JSObject)['display'] = 'none'.toJS;
    final body = document['body'] as JSObject;
    body.callMethod<JSAny?>('appendChild'.toJS, anchor);
    anchor.callMethod<JSAny?>('click'.toJS);
    anchor.callMethod<JSAny?>('remove'.toJS);
    // Dá tempo ao navegador de iniciar o download antes de liberar a memória.
    Timer(
      const Duration(seconds: 30),
      () => urlApi.callMethod<JSAny?>('revokeObjectURL'.toJS, url),
    );
  }

  @override
  Future<bool> share(List<ShareableImage> images, {String? text}) async {
    if (!canShareFiles) {
      throw const ImageShareException(
        'Este navegador não permite compartilhar fotos. Use o botão Baixar.',
      );
    }
    final data = _options({
      'files': images.map(_toFile).toList().toJS,
      if (text != null && text.isNotEmpty) 'text': text.toJS,
    });
    if (!_canShare(data)) {
      throw const ImageShareException(
        'Não foi possível compartilhar estas fotos. Use o botão Baixar.',
      );
    }
    try {
      await _navigator.callMethod<JSPromise<JSAny?>>('share'.toJS, data).toDart;
      return true;
    } catch (error) {
      // AbortError = usuário fechou a janela de compartilhar.
      if (error.toString().contains('AbortError')) return false;
      throw const ImageShareException('Não foi possível compartilhar agora.');
    }
  }
}
