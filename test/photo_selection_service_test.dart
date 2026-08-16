import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/assets/photo_selection_service.dart';

void main() {
  final jpeg = Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  final png = Uint8List.fromList([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  test('aceita JPEG retornado como Uint8List com MIME image/jpeg', () {
    final photo = selectedPhotoFromReaderResult(
      result: jpeg,
      browserMimeType: 'image/jpeg',
      fileName: 'camera.jpg',
    );

    expect(photo.bytes, same(jpeg));
    expect(photo.mimeType, 'image/jpeg');
  });

  for (final extension in ['jpg', 'jpeg']) {
    test('aceita JPEG com MIME vazio e extensão .$extension', () {
      final photo = selectedPhotoFromReaderResult(
        result: jpeg,
        browserMimeType: '',
        fileName: 'foto.$extension',
      );

      expect(photo.mimeType, 'image/jpeg');
      expect(photo.fileName, 'foto.$extension');
    });
  }

  test('aceita PNG e fallback ByteBuffer sem segunda leitura', () {
    final photo = selectedPhotoFromReaderResult(
      result: png.buffer,
      browserMimeType: 'image/png',
      fileName: 'produto.png',
    );

    expect(photo.bytes, png);
    expect(photo.mimeType, 'image/png');
  });

  test('rejeita arquivo vazio', () {
    expect(
      () => selectedPhotoFromReaderResult(
        result: Uint8List(0),
        browserMimeType: 'image/jpeg',
        fileName: 'vazia.jpg',
      ),
      throwsA(
        isA<PhotoSelectionException>()
            .having((error) => error.stage, 'stage', 'byte_validation'),
      ),
    );
  });

  test('rejeita assinatura inválida mesmo com extensão JPEG', () {
    expect(
      () => selectedPhotoFromReaderResult(
        result: Uint8List.fromList([1, 2, 3, 4]),
        browserMimeType: 'image/jpeg',
        fileName: 'falso.jpeg',
      ),
      throwsA(
        isA<PhotoSelectionException>()
            .having((error) => error.stage, 'stage', 'signature_validation'),
      ),
    );
  });

  test('resultado incompatível identifica erro de conversão', () {
    expect(
      () => selectedPhotoFromReaderResult(
        result: 'not-an-array-buffer',
        browserMimeType: 'image/jpeg',
        fileName: 'foto.jpg',
      ),
      throwsA(
        isA<PhotoSelectionException>()
            .having(
              (error) => error.stage,
              'stage',
              'array_buffer_conversion',
            ),
      ),
    );
  });
}
