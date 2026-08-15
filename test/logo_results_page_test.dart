import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/features/logo/logo_results_page.dart';

void main() {
  testWidgets('renderiza exatamente as quatro imagens recebidas', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LogoResultsPage(
          companyName: 'Marca Teste',
          description: 'minimalista',
          style: 'Moderno',
          images: List.filled(4, _onePixelPng),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(Image), findsNWidgets(4));
    for (var index = 1; index <= 4; index++) {
      expect(find.text('Logo $index'), findsOneWidget);
    }
  });
}

final Uint8List _onePixelPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);
