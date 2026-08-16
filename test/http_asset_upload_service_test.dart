import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/assets/asset_upload_service.dart';
import 'package:meu_app/core/assets/data/asset_http_transport.dart';
import 'package:meu_app/core/assets/data/http_asset_upload_service.dart';
import 'package:meu_app/core/generation/generation_types.dart';

void main() {
  test('envia bytes sem Base64 e interpreta AssetReference', () async {
    final transport = _FakeAssetTransport();
    final service = HttpAssetUploadService(
      baseUrl: 'http://api.example',
      transport: transport,
    );
    final bytes = Uint8List.fromList([0x89, 0x50, 0x4e, 0x47]);

    final asset = await service.uploadImage(
      bytes: bytes,
      mimeType: 'image/png',
      role: AssetRole.product,
    );

    expect(transport.lastBytes, bytes);
    expect(transport.lastMimeType, 'image/png');
    expect(asset.id, '00000000-0000-4000-8000-000000000001');
    expect(asset.role, AssetRole.product);
    expect(
      asset.temporaryUrl,
      'http://api.example/v1/assets/images/00000000-0000-4000-8000-000000000001',
    );
    expect(asset.retentionPolicy, AssetRetentionPolicy.temporary);
  });

  test('erro HTTP do upload é retornado de forma sanitizada', () async {
    final service = HttpAssetUploadService(
      baseUrl: 'http://api.example',
      transport: _FakeAssetTransport(
        response: (statusCode: 415, body: '{"error":"Imagem inválida."}'),
      ),
    );

    await expectLater(
      service.uploadImage(
        bytes: Uint8List.fromList([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
      ),
      throwsA(
        isA<AssetUploadException>()
            .having((error) => error.message, 'message', 'Imagem inválida.'),
      ),
    );
  });
}

class _FakeAssetTransport implements AssetHttpTransport {
  _FakeAssetTransport({this.response});

  final AssetHttpResponse? response;
  Uint8List? lastBytes;
  String? lastMimeType;

  @override
  Future<AssetHttpResponse> postBytes(
    Uri uri,
    Uint8List bytes,
    String mimeType,
  ) async {
    lastBytes = bytes;
    lastMimeType = mimeType;
    return response ?? (
      statusCode: 201,
      body: jsonEncode({
        'asset': {
          'id': '00000000-0000-4000-8000-000000000001',
          'mediaType': 'image',
          'mimeType': 'image/png',
          'role': 'product',
          'width': 1,
          'height': 1,
          'hash': 'hash',
          'temporaryUrl':
              '/v1/assets/images/00000000-0000-4000-8000-000000000001',
          'retentionPolicy': 'temporary',
          'expiresAt': '2026-08-15T13:00:00.000Z',
        },
      }),
    );
  }
}
