import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/assets/asset_upload_service.dart';
import 'package:meu_app/core/assets/photo_selection_service.dart';
import 'package:meu_app/core/generation/generation_request.dart';
import 'package:meu_app/core/generation/generation_types.dart';
import 'package:meu_app/features/product_photo/domain/product_photo_generation_service.dart';
import 'package:meu_app/features/product_photo/product_photo_page.dart';

void main() {
  testWidgets('mantém loading e só navega após receber quatro propostas', (
    tester,
  ) async {
    final generation = _ControlledGenerationService();
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _FakePhotoSelectionService(),
          uploadService: _FakeUploadService(),
          generationService: generation,
        ),
      ),
    );
    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('GERAR 4 PROPOSTAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('GERAR 4 PROPOSTAS'));
    await tester.pump();

    expect(find.text('CRIANDO 4 PROPOSTAS...'), findsOneWidget);
    expect(find.text('Propostas publicitárias'), findsNothing);
    expect(generation.request?.operation, GenerationOperation.imageToImage);
    expect(generation.request?.outputSpecification.count, 4);

    generation.complete(List.filled(4, _png));
    await tester.pumpAndSettle();

    expect(find.text('Propostas publicitárias'), findsOneWidget);
    expect(find.byType(Image), findsNWidgets(4));
    expect(find.text('Proposta 1'), findsOneWidget);
    expect(find.text('Proposta 4'), findsOneWidget);
  });

  testWidgets('erro não navega e volta a habilitar geração', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _FakePhotoSelectionService(),
          uploadService: _FakeUploadService(),
          generationService: _FailingGenerationService(),
        ),
      ),
    );
    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('GERAR 4 PROPOSTAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('GERAR 4 PROPOSTAS'));
    await tester.pumpAndSettle();

    expect(find.text('Falha controlada na transformação.'), findsOneWidget);
    expect(find.text('Propostas publicitárias'), findsNothing);
    expect(find.text('GERAR 4 PROPOSTAS'), findsOneWidget);
  });

  testWidgets('cancelamento do seletor mantém a tela sem erro', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _CallbackPhotoSelectionService(
            () async => null,
          ),
          uploadService: _FakeUploadService(),
          generationService: _FailingGenerationService(),
        ),
      ),
    );

    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();

    expect(find.text('SELECIONAR FOTO'), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('erro de leitura é exibido e não inicia upload', (tester) async {
    final upload = _FakeUploadService();
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _CallbackPhotoSelectionService(() async {
            throw const PhotoSelectionException(
              'Não foi possível ler esta foto.',
              stage: 'file_reader',
              exceptionType: 'FileReaderError',
            );
          }),
          uploadService: upload,
          generationService: _FailingGenerationService(),
        ),
      ),
    );

    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();

    expect(find.text('Não foi possível ler esta foto.'), findsOneWidget);
    expect(upload.calls, 0);
  });

  testWidgets('arquivo inválido não cria preview nem inicia upload', (
    tester,
  ) async {
    final upload = _FakeUploadService();
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _CallbackPhotoSelectionService(
            () async => SelectedPhoto(
              bytes: Uint8List.fromList([1, 2, 3]),
              mimeType: 'image/jpeg',
              fileName: 'falso.jpg',
            ),
          ),
          uploadService: upload,
          generationService: _FailingGenerationService(),
        ),
      ),
    );

    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();

    expect(
      find.text('Selecione uma imagem PNG ou JPEG válida.'),
      findsOneWidget,
    );
    expect(find.byType(Image), findsNothing);
    expect(upload.calls, 0);
  });

  testWidgets('falha encerra uploading e permite nova tentativa com sucesso', (
    tester,
  ) async {
    final upload = _RetryUploadService();
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _FakePhotoSelectionService(),
          uploadService: upload,
          generationService: _FailingGenerationService(),
        ),
      ),
    );

    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    expect(find.text('Falha temporária no upload.'), findsOneWidget);
    expect(find.text('Enviando foto...'), findsNothing);
    expect(find.text('SELECIONAR FOTO'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('GERAR 4 PROPOSTAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );

    await tester.scrollUntilVisible(
      find.text('SELECIONAR FOTO'),
      -500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    expect(find.text('Foto protegida temporariamente'), findsOneWidget);
    expect(upload.calls, 2);

    await tester.scrollUntilVisible(
      find.text('GERAR 4 PROPOSTAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
  });
}

final Uint8List _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

class _FakePhotoSelectionService implements PhotoSelectionService {
  @override
  Future<SelectedPhoto?> selectImage() async =>
      SelectedPhoto(bytes: _png, mimeType: 'image/png');
}

class _FakeUploadService implements AssetUploadService {
  int calls = 0;

  @override
  Future<AssetReference> uploadImage({
    required Uint8List bytes,
    required String mimeType,
    AssetRole role = AssetRole.product,
  }) async {
    calls += 1;
    return AssetReference(
      id: '00000000-0000-4000-8000-000000000001',
      mediaType: AssetMediaType.image,
      mimeType: mimeType,
      role: role,
      width: 1,
      height: 1,
      internalReference: 'asset:test',
      retentionPolicy: AssetRetentionPolicy.temporary,
    );
  }
}

class _CallbackPhotoSelectionService implements PhotoSelectionService {
  _CallbackPhotoSelectionService(this.callback);

  final Future<SelectedPhoto?> Function() callback;

  @override
  Future<SelectedPhoto?> selectImage() => callback();
}

class _RetryUploadService implements AssetUploadService {
  int calls = 0;

  @override
  Future<AssetReference> uploadImage({
    required Uint8List bytes,
    required String mimeType,
    AssetRole role = AssetRole.product,
  }) async {
    calls += 1;
    if (calls == 1) {
      throw const AssetUploadException('Falha temporária no upload.');
    }
    return AssetReference(
      id: '00000000-0000-4000-8000-000000000001',
      mediaType: AssetMediaType.image,
      mimeType: mimeType,
      role: role,
      width: 1,
      height: 1,
      internalReference: 'asset:test',
      retentionPolicy: AssetRetentionPolicy.temporary,
    );
  }
}

class _ControlledGenerationService implements ProductPhotoGenerationService {
  final _completer = Completer<List<Uint8List>>();
  GenerationRequest? request;

  void complete(List<Uint8List> images) => _completer.complete(images);

  @override
  Future<List<Uint8List>> generateFour(GenerationRequest request) {
    this.request = request;
    return _completer.future;
  }
}

class _FailingGenerationService implements ProductPhotoGenerationService {
  @override
  Future<List<Uint8List>> generateFour(GenerationRequest request) {
    throw const ProductPhotoGenerationException(
      'Falha controlada na transformação.',
    );
  }
}
