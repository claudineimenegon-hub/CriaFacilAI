import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import '../../config/app_config.dart';
import '../../generation/generation_types.dart';
import '../asset_upload_service.dart';
import 'asset_http_transport.dart';

class HttpAssetUploadService implements AssetUploadService {
  HttpAssetUploadService({String? baseUrl, AssetHttpTransport? transport})
    : _baseUrl = (baseUrl ?? AppConfig.apiBaseUrl).replaceAll(
        RegExp(r'/+$'),
        '',
      ),
      _transport = transport ?? createAssetHttpTransport();

  final String _baseUrl;
  final AssetHttpTransport _transport;

  @override
  Future<AssetReference> uploadImage({
    required Uint8List bytes,
    required String mimeType,
    AssetRole role = AssetRole.product,
  }) async {
    if (_baseUrl.isEmpty) {
      throw const AssetUploadException(
        'O servidor de upload ainda não foi configurado.',
      );
    }
    try {
      final response = await _transport
          .postBytes(Uri.parse('$_baseUrl/v1/assets/images'), bytes, mimeType)
          .timeout(const Duration(seconds: 45));
      final payload = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw AssetUploadException(
          payload['error'] as String? ?? 'Não foi possível enviar a imagem.',
        );
      }
      final assetJson = Map<String, dynamic>.from(
        payload['asset'] as Map<dynamic, dynamic>,
      );
      final relativeUrl = assetJson['temporaryUrl'] as String?;
      if (relativeUrl != null) {
        assetJson['temporaryUrl'] = Uri.parse('$_baseUrl/')
            .resolve(relativeUrl)
            .toString();
      }
      assetJson['role'] = role.name;
      return AssetReference.fromJson(assetJson);
    } on AssetUploadException {
      rethrow;
    } on TimeoutException {
      throw const AssetUploadException(
        'O envio demorou demais. Tente novamente.',
      );
    } on FormatException {
      throw const AssetUploadException('O servidor retornou dados inválidos.');
    } on AssetHttpTransportException catch (error) {
      throw AssetUploadException(error.message);
    } catch (_) {
      throw const AssetUploadException('Não foi possível enviar a imagem.');
    }
  }
}
