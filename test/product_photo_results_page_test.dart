import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/features/product_photo/product_photo_results_page.dart';

void main() {
  testWidgets('renderiza quatro imagens e amplia a selecionada', (
    tester,
  ) async {
    final image = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoResultsPage(
          images: List.filled(4, image),
          title: 'Estúdio Premium',
        ),
      ),
    );

    expect(find.byType(Image), findsNWidgets(4));
    await tester.tap(find.text('Proposta 1'));
    await tester.pumpAndSettle();

    expect(find.byType(Dialog), findsOneWidget);
    expect(find.byTooltip('Fechar'), findsOneWidget);
  });
}
