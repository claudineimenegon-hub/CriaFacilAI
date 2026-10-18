import 'dart:async';
import 'dart:convert';

import '../../../core/config/app_config.dart';
import '../../image/data/http_transport.dart';
import '../domain/ad_copy.dart';

class HttpAdCopyService implements AdCopyService {
  HttpAdCopyService({String? baseUrl, ImageHttpTransport? transport})
    : _baseUrl = (baseUrl ?? AppConfig.apiBaseUrl).replaceAll(
        RegExp(r'/+$'),
        '',
      ),
      _transport = transport ?? createImageHttpTransport();

  final String _baseUrl;
  final ImageHttpTransport _transport;

  @override
  Future<AdCopyResult> generate(AdCopyRequest request) async {
    if (_baseUrl.isEmpty) {
      throw const AdCopyException('O servidor ainda não foi configurado.');
    }
    try {
      final response = await _transport
          .postJson(
            Uri.parse('$_baseUrl/v1/ads/copy'),
            jsonEncode(request.toJson()),
          )
          .timeout(const Duration(seconds: 90));
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw AdCopyException(
          body['error'] as String? ?? 'Não foi possível criar os textos.',
        );
      }
      final result = AdCopyResult.fromJson(
        Map<String, dynamic>.from(body['copy'] as Map<dynamic, dynamic>),
      );
      if (result.platforms.isEmpty) {
        throw const AdCopyException('O servidor não retornou textos.');
      }
      return result;
    } on AdCopyException {
      rethrow;
    } on TimeoutException {
      throw const AdCopyException('Demorou demais. Tente novamente.');
    } on FormatException {
      throw const AdCopyException('O servidor retornou uma resposta inválida.');
    } on ImageHttpTransportException catch (error) {
      throw AdCopyException(error.message);
    } catch (_) {
      throw const AdCopyException('Não foi possível criar os textos agora.');
    }
  }
}
