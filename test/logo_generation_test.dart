import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/features/image/domain/image_generation_service.dart';
import 'package:meu_app/features/logo/logo_page.dart';

void main() {
  testWidgets('gera o prompt e só navega depois de receber a imagem', (
    tester,
  ) async {
    final service = _ControlledService();
    await tester.pumpWidget(MaterialApp(home: LogoPage(service: service)));

    await tester.enterText(
      find.widgetWithText(TextField, 'Nome da empresa'),
      'Café Aurora',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Como você imagina o logotipo?'),
      'azul e dourado',
    );
    await tester.tap(find.text('Minimalista'));
    await tester.ensureVisible(find.text('GERAR LOGOTIPO'));
    await tester.tap(find.text('GERAR LOGOTIPO'));
    await tester.pump();

    expect(find.text('CRIANDO LOGOTIPO...'), findsOneWidget);
    expect(find.text('Seus logotipos'), findsNothing);
    expect(service.lastPrompt, contains('Café Aurora'));
    expect(service.lastPrompt, contains('Minimalista'));
    expect(service.lastPrompt, contains('azul e dourado'));

    service.complete(List.filled(4, _onePixelPng));
    await tester.pumpAndSettle();

    expect(find.text('Seus logotipos'), findsOneWidget);
    expect(service.lastCount, 4);
    expect(find.byType(Image), findsNWidgets(4));
    expect(find.text('Logo 1'), findsOneWidget);
    expect(find.text('Logo 4'), findsOneWidget);
  });

  testWidgets('mostra erro amigável e não navega quando a geração falha', (
    tester,
  ) async {
    final service = _FailingService();
    await tester.pumpWidget(MaterialApp(home: LogoPage(service: service)));

    await tester.enterText(
      find.widgetWithText(TextField, 'Nome da empresa'),
      'Empresa Teste',
    );
    await tester.ensureVisible(find.text('GERAR LOGOTIPO'));
    await tester.tap(find.text('GERAR LOGOTIPO'));
    await tester.pumpAndSettle();

    expect(find.text('Não foi possível gerar agora.'), findsOneWidget);
    expect(find.text('Seus logotipos'), findsNothing);
    expect(find.text('GERAR LOGOTIPO'), findsOneWidget);
  });
}

final Uint8List _onePixelPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

class _ControlledService implements ImageGenerationService {
  final _completer = Completer<List<Uint8List>>();
  String? lastPrompt;
  int? lastCount;

  void complete(List<Uint8List> images) => _completer.complete(images);

  @override
  Future<Uint8List> generate({required String prompt}) async {
    return (await generateMany(prompt: prompt, count: 1)).first;
  }

  @override
  Future<List<Uint8List>> generateMany({
    required String prompt,
    required int count,
  }) {
    lastPrompt = prompt;
    lastCount = count;
    return _completer.future;
  }
}

class _FailingService implements ImageGenerationService {
  @override
  Future<Uint8List> generate({required String prompt}) {
    throw const ImageGenerationException('Não foi possível gerar agora.');
  }

  @override
  Future<List<Uint8List>> generateMany({
    required String prompt,
    required int count,
  }) {
    throw const ImageGenerationException('Não foi possível gerar agora.');
  }
}
