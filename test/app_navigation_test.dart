import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/app/app.dart';

void main() {
  testWidgets('exibe e navega pelas quatro áreas principais', (tester) async {
    await tester.pumpWidget(const LogoFacilApp());
    expect(find.text('Crie com inteligência artificial'), findsOneWidget);
    expect(find.byType(NavigationDestination), findsNWidgets(4));

    for (final destination in <String, String>{
      'Modelos': 'Modelos para começar rápido',
      'Ferramentas IA': 'Ferramentas inteligentes',
      'Histórico': 'Nenhuma criação ainda',
    }.entries) {
      await tester.tap(find.text(destination.key));
      await tester.pumpAndSettle();
      expect(find.text(destination.value), findsOneWidget);
    }
  });

  testWidgets('abre o módulo Logo e mantém a validação existente', (
    tester,
  ) async {
    await tester.pumpWidget(const LogoFacilApp());
    await tester.scrollUntilVisible(
      find.text('Criar Logo'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Criar Logo'));
    await tester.pumpAndSettle();
    final generateButton = find.text('GERAR LOGOTIPO');
    await tester.ensureVisible(generateButton);
    await tester.tap(generateButton);
    await tester.pumpAndSettle();
    expect(find.text('Digite o nome da empresa.'), findsOneWidget);
    expect(find.text('Seus logotipos'), findsNothing);
  });

  testWidgets('abre a geração real de imagem pela Home', (tester) async {
    await tester.pumpWidget(const LogoFacilApp());
    await tester.tap(find.text('Criar Imagem'));
    await tester.pumpAndSettle();

    expect(find.text('Imagens com sua ideia'), findsOneWidget);
    expect(find.text('GERAR IMAGEM'), findsOneWidget);
  });
}
