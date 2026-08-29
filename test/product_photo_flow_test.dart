import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/core/assets/asset_upload_service.dart';
import 'package:meu_app/core/assets/photo_selection_service.dart';
import 'package:meu_app/core/generation/generation_request.dart';
import 'package:meu_app/core/generation/generation_types.dart';
import 'package:meu_app/features/product_photo/domain/experimental_v3_generation_service.dart';
import 'package:meu_app/features/product_photo/product_photo_page.dart';

void main() {
  testWidgets('usa somente V3 e só navega após quatro campanhas completas', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final generation = _ControlledExperimentalV3Service();
    final stopwatch = _FakeStopwatch();
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _FakePhotoSelectionService(),
          uploadService: _FakeUploadService(),
          experimentalV3GenerationService: generation,
          generationStopwatchFactory: () => stopwatch,
        ),
      ),
    );
    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('GERAR 4 CAMPANHAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('GERAR 4 CAMPANHAS'));
    await tester.pump();

    expect(find.text('Gerando quatro campanhas...'), findsOneWidget);
    expect(find.text('Tempo decorrido: 00:00'), findsOneWidget);
    expect(find.text('Isso pode levar alguns minutos.'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    expect(generation.request?.operation, GenerationOperation.imageToImage);
    expect(generation.request?.outputSpecification.count, 4);
    expect(generation.calls, 1);

    await tester.tap(find.text('AGUARDE...'), warnIfMissed: false);
    stopwatch.elapsedValue = const Duration(seconds: 2);
    await tester.pump(const Duration(seconds: 2));
    expect(generation.calls, 1);
    expect(find.text('Tempo decorrido: 00:02'), findsOneWidget);

    generation.complete(_completedCampaigns());
    await tester.pumpAndSettle();

    expect(find.text('Creative Director'), findsOneWidget);
    expect(find.text('Quatro campanhas concluídas em 00:02'), findsOneWidget);
    expect(find.byType(Image), findsNWidgets(4));
    expect(find.text('Hero Comercial — concluído'), findsOneWidget);
    expect(find.text('Lifestyle — concluído'), findsOneWidget);
    expect(find.text('Detalhes / Editorial — concluído'), findsOneWidget);
    expect(find.text('Campanha Conceitual — concluído'), findsOneWidget);
  });

  testWidgets('falha V3 não navega, não faz fallback e reabilita o botão', (
    tester,
  ) async {
    final generation = _ControlledExperimentalV3Service();
    final stopwatch = _FakeStopwatch();
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _FakePhotoSelectionService(),
          uploadService: _FakeUploadService(),
          experimentalV3GenerationService: generation,
          generationStopwatchFactory: () => stopwatch,
        ),
      ),
    );
    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('GERAR 4 CAMPANHAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('GERAR 4 CAMPANHAS'));
    await tester.pump();
    stopwatch.elapsedValue = const Duration(seconds: 3);
    await tester.pump(const Duration(seconds: 3));
    generation.fail(
      const ExperimentalV3GenerationException(
        'Falha controlada no Creative Director.',
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text(
        'Não foi possível gerar as quatro campanhas após 00:03. '
        'Falha controlada no Creative Director.',
      ),
      findsOneWidget,
    );
    expect(find.text('GERAR 4 CAMPANHAS'), findsOneWidget);
    expect(generation.calls, 1);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
  });

  testWidgets(
    'não aceita sucesso quando uma das quatro campanhas está incompleta',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final experimental = _ControlledExperimentalV3Service();
      await tester.pumpWidget(
        MaterialApp(
          home: ProductPhotoPage(
            photoSelectionService: _FakePhotoSelectionService(),
            uploadService: _FakeUploadService(),
            experimentalV3GenerationService: experimental,
          ),
        ),
      );
      await tester.tap(find.text('SELECIONAR FOTO'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('GERAR 4 CAMPANHAS'),
        600,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(find.text('GERAR 4 CAMPANHAS'));
      await tester.pumpAndSettle();
      final generateButton = tester.widget<FilledButton>(
        find.byType(FilledButton),
      );
      expect(generateButton.onPressed, isNotNull);
      generateButton.onPressed!();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.text('Gerando quatro campanhas...'), findsOneWidget);
      expect(experimental.calls, 1);
      expect(experimental.quality, 'medium');

      experimental.complete([
        for (final role in [
          'hero_commercial',
          'contextual_lifestyle',
          'editorial_craft_detail',
        ])
          ExperimentalV3ImageResult(
            campaignRole: role,
            status: 'completed',
            imageBytes: _png,
          ),
        const ExperimentalV3ImageResult(
          campaignRole: 'concept_campaign',
          status: 'error',
          errorMessage: 'Não foi possível gerar esta proposta.',
        ),
      ]);
      await tester.pumpAndSettle();

      expect(
        find.textContaining(
          'O Creative Director não retornou as quatro campanhas completas.',
        ),
        findsOneWidget,
      );
      expect(find.text('Hero Comercial — concluído'), findsNothing);
    },
  );

  testWidgets('cancelamento do seletor mantém a tela sem erro', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _CallbackPhotoSelectionService(
            () async => null,
          ),
          uploadService: _FakeUploadService(),
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
          experimentalV3GenerationService: _ControlledExperimentalV3Service(),
        ),
      ),
    );

    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    expect(find.text('Falha temporária no upload.'), findsOneWidget);
    expect(find.text('Enviando foto...'), findsNothing);
    expect(find.text('SELECIONAR FOTO'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('GERAR 4 CAMPANHAS'),
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
      find.text('GERAR 4 CAMPANHAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
  });

  testWidgets('dispose cancela timer e conclusão tardia não chama setState', (
    tester,
  ) async {
    final generation = _ControlledExperimentalV3Service();
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _FakePhotoSelectionService(),
          uploadService: _FakeUploadService(),
          experimentalV3GenerationService: generation,
        ),
      ),
    );
    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('GERAR 4 CAMPANHAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('GERAR 4 CAMPANHAS'));
    await tester.pump();
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    await tester.pump(const Duration(seconds: 2));
    generation.complete(_completedCampaigns());
    await tester.pump();

    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'inventário múltiplo bloqueia geração até vincular referências isoladas',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = _MultiInventoryExperimentalV3Service();
      await tester.pumpWidget(
        MaterialApp(
          home: ProductPhotoPage(
            photoSelectionService: _FakePhotoSelectionService(),
            uploadService: _HashUploadService(),
            experimentalV3GenerationService: service,
          ),
        ),
      );
      await tester.tap(find.text('SELECIONAR FOTO'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('wearable product'),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        find.byKey(const ValueKey('canonical-item-canonical-a')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('canonical-item-canonical-b')),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(
        find.text('GERAR 4 CAMPANHAS'),
        500,
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      for (var index = 0; index < 2; index += 1) {
        await tester.tap(find.text('VINCULAR FOTO').first);
        await tester.pumpAndSettle();
      }
      await tester.scrollUntilVisible(
        find.text('GERAR 4 CAMPANHAS'),
        500,
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNotNull,
      );
    },
  );

  testWidgets('nova geração reinicia o cronômetro em zero', (tester) async {
    final generation = _SequencedExperimentalV3Service();
    final stopwatch = _FakeStopwatch();
    await tester.pumpWidget(
      MaterialApp(
        home: ProductPhotoPage(
          photoSelectionService: _FakePhotoSelectionService(),
          uploadService: _FakeUploadService(),
          experimentalV3GenerationService: generation,
          generationStopwatchFactory: () => stopwatch,
        ),
      ),
    );
    await tester.tap(find.text('SELECIONAR FOTO'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('GERAR 4 CAMPANHAS'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('GERAR 4 CAMPANHAS'));
    stopwatch.elapsedValue = const Duration(seconds: 2);
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('Tempo decorrido: 00:02'), findsOneWidget);
    generation.failCurrent();
    await tester.pumpAndSettle();

    await tester.tap(find.text('GERAR 4 CAMPANHAS'));
    await tester.pump();
    expect(find.text('Tempo decorrido: 00:00'), findsOneWidget);
    expect(generation.calls, 2);
    generation.completeCurrent(_completedCampaigns());
    await tester.pumpAndSettle();
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

class _HashUploadService implements AssetUploadService {
  int calls = 0;
  @override
  Future<AssetReference> uploadImage({
    required Uint8List bytes,
    required String mimeType,
    AssetRole role = AssetRole.product,
  }) async {
    calls += 1;
    final suffix = calls.toString().padLeft(12, '0');
    return AssetReference(
      id: '00000000-0000-4000-8000-$suffix',
      mediaType: AssetMediaType.image,
      mimeType: mimeType,
      role: role,
      width: 1,
      height: 1,
      hash: calls.toRadixString(16).padLeft(64, '0'),
      internalReference: 'asset:$suffix',
      retentionPolicy: AssetRetentionPolicy.temporary,
    );
  }
}

class _ControlledExperimentalV3Service
    implements ExperimentalV3GenerationService {
  final _completer = Completer<List<ExperimentalV3ImageResult>>();
  int calls = 0;
  String? quality;
  GenerationRequest? request;

  @override
  Future<CanonicalInventory> analyzeInventory(
    GenerationRequest request,
  ) async => CanonicalInventory(
    analysisId: '00000000-0000-4000-8000-000000000099',
    items: const [
      CanonicalInventoryItem(
        id: 'product-1',
        functionalType: 'product',
        quantity: 1,
      ),
    ],
    source: request.inputs.single,
  );

  void complete(List<ExperimentalV3ImageResult> results) =>
      _completer.complete(results);

  void fail(ExperimentalV3GenerationException error) =>
      _completer.completeError(error);

  @override
  Future<List<ExperimentalV3ImageResult>> generateFour(
    GenerationRequest request, {
    required String analysisId,
    required String quality,
    List<CanonicalVisualAssetBinding> canonicalVisualAssets = const [],
  }) {
    calls += 1;
    this.quality = quality;
    this.request = request;
    return _completer.future;
  }
}

class _SequencedExperimentalV3Service
    implements ExperimentalV3GenerationService {
  Completer<List<ExperimentalV3ImageResult>>? _current;
  int calls = 0;

  @override
  Future<CanonicalInventory> analyzeInventory(
    GenerationRequest request,
  ) async => CanonicalInventory(
    analysisId: '00000000-0000-4000-8000-000000000099',
    items: const [
      CanonicalInventoryItem(
        id: 'product-1',
        functionalType: 'product',
        quantity: 1,
      ),
    ],
    source: request.inputs.single,
  );

  void failCurrent() => _current!.completeError(
    const ExperimentalV3GenerationException('Falha controlada.'),
  );

  void completeCurrent(List<ExperimentalV3ImageResult> results) =>
      _current!.complete(results);

  @override
  Future<List<ExperimentalV3ImageResult>> generateFour(
    GenerationRequest request, {
    required String analysisId,
    required String quality,
    List<CanonicalVisualAssetBinding> canonicalVisualAssets = const [],
  }) {
    calls += 1;
    _current = Completer<List<ExperimentalV3ImageResult>>();
    return _current!.future;
  }
}

class _MultiInventoryExperimentalV3Service
    implements ExperimentalV3GenerationService {
  @override
  Future<CanonicalInventory> analyzeInventory(
    GenerationRequest request,
  ) async => CanonicalInventory(
    analysisId: '00000000-0000-4000-8000-000000000099',
    items: const [
      CanonicalInventoryItem(
        id: 'canonical-a',
        functionalType: 'wearable product',
        quantity: 1,
      ),
      CanonicalInventoryItem(
        id: 'canonical-b',
        functionalType: 'paired product',
        quantity: 2,
      ),
    ],
    source: request.inputs.single,
  );

  @override
  Future<List<ExperimentalV3ImageResult>> generateFour(
    GenerationRequest request, {
    required String analysisId,
    required String quality,
    List<CanonicalVisualAssetBinding> canonicalVisualAssets = const [],
  }) => throw UnimplementedError();
}

List<ExperimentalV3ImageResult> _completedCampaigns() => [
  for (final role in const [
    'hero_commercial',
    'contextual_lifestyle',
    'editorial_craft_detail',
    'concept_campaign',
  ])
    ExperimentalV3ImageResult(
      campaignRole: role,
      status: 'completed',
      imageBytes: _png,
    ),
];

class _FakeStopwatch implements Stopwatch {
  Duration elapsedValue = Duration.zero;
  bool _running = false;

  @override
  Duration get elapsed => elapsedValue;

  @override
  int get elapsedMicroseconds => elapsedValue.inMicroseconds;

  @override
  int get elapsedMilliseconds => elapsedValue.inMilliseconds;

  @override
  int get elapsedTicks => elapsedValue.inMicroseconds;

  @override
  int get frequency => Duration.microsecondsPerSecond;

  @override
  bool get isRunning => _running;

  @override
  void reset() => elapsedValue = Duration.zero;

  @override
  void start() => _running = true;

  @override
  void stop() => _running = false;
}
