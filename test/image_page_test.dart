import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/features/image/domain/image_generation_service.dart';
import 'package:meu_app/features/image/image_page.dart';

void main() {
  testWidgets('valida uma descrição vazia', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: ImagePage(service: _FakeService())),
    );
    final button = find.text('GERAR IMAGEM');
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();

    expect(find.text('Descreva a imagem que deseja criar.'), findsOneWidget);
  });

  testWidgets('exibe a imagem devolvida pelo serviço', (tester) async {
    final service = _FakeService();
    await tester.pumpWidget(MaterialApp(home: ImagePage(service: service)));
    await tester.enterText(find.byType(TextField), 'Uma marca moderna em azul');
    final button = find.text('GERAR IMAGEM');
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();

    expect(service.lastPrompt, 'Uma marca moderna em azul');
    expect(find.byType(Image), findsOneWidget);
  });

  testWidgets('mantém loading até a geração singular terminar', (tester) async {
    final service = _ControlledService();
    await tester.pumpWidget(MaterialApp(home: ImagePage(service: service)));
    await tester.enterText(find.byType(TextField), 'Produto em estúdio');
    await tester.tap(find.text('GERAR IMAGEM'));
    await tester.pump();

    expect(find.text('CRIANDO IMAGEM...'), findsOneWidget);
    expect(find.byType(Image), findsNothing);

    service.complete(_onePixelPng);
    await tester.pumpAndSettle();

    expect(find.text('GERAR IMAGEM'), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
  });

  testWidgets('exibe erro amigável na geração singular', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: ImagePage(service: _FailingService())),
    );
    await tester.enterText(find.byType(TextField), 'Produto em estúdio');
    await tester.tap(find.text('GERAR IMAGEM'));
    await tester.pumpAndSettle();

    expect(find.text('Falha de geração controlada.'), findsOneWidget);
    expect(find.text('GERAR IMAGEM'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });
}

final Uint8List _onePixelPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

class _FakeService implements ImageGenerationService {
  String? lastPrompt;

  @override
  Future<Uint8List> generate({required String prompt}) async {
    lastPrompt = prompt;
    return base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );
  }

  @override
  Future<List<Uint8List>> generateMany({
    required String prompt,
    required int count,
  }) {
    return Future.wait(List.generate(count, (_) => generate(prompt: prompt)));
  }
}

class _ControlledService implements ImageGenerationService {
  final _completer = Completer<Uint8List>();

  void complete(Uint8List image) => _completer.complete(image);

  @override
  Future<Uint8List> generate({required String prompt}) => _completer.future;

  @override
  Future<List<Uint8List>> generateMany({
    required String prompt,
    required int count,
  }) async => List.filled(count, await generate(prompt: prompt));
}

class _FailingService implements ImageGenerationService {
  @override
  Future<Uint8List> generate({required String prompt}) {
    throw const ImageGenerationException('Falha de geração controlada.');
  }

  @override
  Future<List<Uint8List>> generateMany({
    required String prompt,
    required int count,
  }) {
    throw const ImageGenerationException('Falha de geração controlada.');
  }
}
