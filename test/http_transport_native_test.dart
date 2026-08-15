import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/features/image/data/http_transport.dart';

void main() {
  test('transporte nativo envia POST JSON e lê a resposta', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));

    final requestHandled = server.first.then((request) async {
      expect(request.method, 'POST');
      expect(request.headers.contentType?.mimeType, 'application/json');
      expect(await utf8.decoder.bind(request).join(), '{"prompt":"teste"}');
      request.response
        ..statusCode = HttpStatus.created
        ..headers.contentType = ContentType.json
        ..write('{"ok":true}');
      await request.response.close();
    });

    final response = await createImageHttpTransport().postJson(
      Uri.parse('http://127.0.0.1:${server.port}/generate'),
      '{"prompt":"teste"}',
    );
    await requestHandled;

    expect(response.statusCode, HttpStatus.created);
    expect(response.body, '{"ok":true}');
  });
}
