import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/assets/asset_upload_service.dart';
import '../../core/assets/data/http_asset_upload_service.dart';
import '../../core/assets/photo_selection_service.dart';
import '../../core/generation/generation_types.dart';
import '../../core/generation/generation_request.dart';
import 'data/http_experimental_v3_generation_service.dart';
import 'domain/experimental_v3_generation_service.dart';
import 'domain/product_photo_draft.dart';
import 'experimental_v3_results_page.dart';
import 'generation_duration_formatter.dart';

enum _QuickMode { none, background, scene, lighting }

class ProductPhotoPage extends StatefulWidget {
  const ProductPhotoPage({
    super.key,
    this.uploadService,
    this.photoSelectionService,
    this.experimentalV3GenerationService,
    this.generationStopwatchFactory = Stopwatch.new,
  });

  final AssetUploadService? uploadService;
  final PhotoSelectionService? photoSelectionService;
  final ExperimentalV3GenerationService? experimentalV3GenerationService;
  final Stopwatch Function() generationStopwatchFactory;

  @override
  State<ProductPhotoPage> createState() => _ProductPhotoPageState();
}

class _ProductPhotoPageState extends State<ProductPhotoPage> {
  final _descriptionController = TextEditingController();
  late final AssetUploadService _uploadService;
  late final PhotoSelectionService _photoSelectionService;
  late final ExperimentalV3GenerationService _experimentalV3GenerationService;
  Uint8List? _previewBytes;
  AssetReference? _asset;
  CanonicalInventory? _canonicalInventory;
  final Map<String, AssetReference> _isolatedReferences = {};
  ProductCategory _category = ProductCategory.general;
  ProductVisualObjective _objective = ProductVisualObjective.premiumStudio;
  String _aspectRatio = '1:1';
  bool _isUploading = false;
  bool _isGenerating = false;
  bool _isAnalyzingInventory = false;
  String? _uploadingCanonicalItemId;
  late final Stopwatch _generationStopwatch;
  Timer? _generationTimer;
  Duration _generationElapsed = Duration.zero;
  String _experimentalQuality = 'medium';
  bool _preserveProduct = true;
  bool _preservePackaging = true;
  bool _preserveLabel = true;
  bool _preserveLogo = true;
  bool _preserveColors = true;
  bool _preserveProportions = true;
  bool _preserveFace = true;
  bool _preserveClothing = true;
  _QuickMode _quickMode = _QuickMode.none;

  @override
  void initState() {
    super.initState();
    _generationStopwatch = widget.generationStopwatchFactory();
    _uploadService = widget.uploadService ?? HttpAssetUploadService();
    _photoSelectionService =
        widget.photoSelectionService ?? createPhotoSelectionService();
    _experimentalV3GenerationService =
        widget.experimentalV3GenerationService ??
        HttpExperimentalV3GenerationService();
  }

  @override
  void dispose() {
    _generationTimer?.cancel();
    _generationStopwatch.stop();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _selectImage() async {
    try {
      final selected = await _photoSelectionService.selectImage();
      if (selected == null) return;
      final bytes = selected.bytes;
      final mimeType = detectSupportedImageMime(bytes);
      if (mimeType == null) {
        _showMessage('Selecione uma imagem PNG ou JPEG válida.');
        return;
      }
      setState(() {
        _previewBytes = bytes;
        _asset = null;
        _isUploading = true;
      });
      final asset = await _uploadService.uploadImage(
        bytes: bytes,
        mimeType: mimeType,
        role: _category == ProductCategory.person
            ? AssetRole.person
            : AssetRole.product,
      );
      if (mounted) {
        setState(() => _asset = asset);
        await _analyzeInventory(asset);
      }
    } on AssetUploadException catch (error) {
      if (mounted) {
        setState(() {
          _previewBytes = null;
          _asset = null;
        });
        _showMessage(error.message);
      }
    } on PhotoSelectionException catch (error) {
      if (mounted) _showMessage(error.message);
    } on Exception {
      if (mounted) _showMessage('Não foi possível selecionar esta imagem.');
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  void _removeImage() => setState(() {
    _previewBytes = null;
    _asset = null;
    _canonicalInventory = null;
    _isolatedReferences.clear();
  });

  GenerationRequest _buildRequest(AssetReference asset) =>
      ProductPhotoDraft(
        asset: asset,
        category: _category,
        objective: _objective,
        description: _descriptionController.text,
        aspectRatio: _aspectRatio,
        preservationOptions: PreservationOptions(
          preserveProduct: _preserveProduct,
          preservePackaging: _preservePackaging,
          preserveLabel: _preserveLabel,
          preservePrintedText: _preserveLabel,
          preserveLogo: _preserveLogo,
          preserveFace: _category == ProductCategory.person && _preserveFace,
          preserveClothing:
              _category == ProductCategory.person && _preserveClothing,
          preserveColors: _preserveColors,
          preserveProportions: _preserveProportions,
          changeBackgroundOnly: _quickMode == _QuickMode.background,
          changeSceneOnly: _quickMode == _QuickMode.scene,
          changeLightingOnly: _quickMode == _QuickMode.lighting,
        ),
      ).buildRequest(
        idempotencyKey:
            'product-${asset.id}-${DateTime.now().microsecondsSinceEpoch}',
      );

  Future<void> _analyzeInventory(AssetReference asset) async {
    setState(() {
      _isAnalyzingInventory = true;
      _canonicalInventory = null;
      _isolatedReferences.clear();
    });
    try {
      final inventory = await _experimentalV3GenerationService.analyzeInventory(
        _buildRequest(asset),
      );
      if (mounted) setState(() => _canonicalInventory = inventory);
    } on ExperimentalV3GenerationException catch (error) {
      if (mounted) _showMessage(error.message);
    } finally {
      if (mounted) setState(() => _isAnalyzingInventory = false);
    }
  }

  Future<void> _selectIsolatedReference(CanonicalInventoryItem item) async {
    if (_uploadingCanonicalItemId != null) return;
    try {
      final selected = await _photoSelectionService.selectImage();
      if (selected == null) return;
      final mimeType = detectSupportedImageMime(selected.bytes);
      if (mimeType == null) {
        throw const AssetUploadException(
          'Selecione uma imagem PNG ou JPEG válida.',
        );
      }
      setState(() => _uploadingCanonicalItemId = item.id);
      final asset = await _uploadService.uploadImage(
        bytes: selected.bytes,
        mimeType: mimeType,
        role: AssetRole.product,
      );
      if (asset.hash == null || asset.hash!.isEmpty) {
        throw const AssetUploadException(
          'O servidor não confirmou a integridade da referência.',
        );
      }
      if (mounted) setState(() => _isolatedReferences[item.id] = asset);
    } on AssetUploadException catch (error) {
      if (mounted) _showMessage(error.message);
    } on PhotoSelectionException catch (error) {
      if (mounted) _showMessage(error.message);
    } finally {
      if (mounted) setState(() => _uploadingCanonicalItemId = null);
    }
  }

  bool get _canonicalReferencesReady {
    final inventory = _canonicalInventory;
    if (inventory == null) return false;
    return inventory.items.length == 1 ||
        inventory.items.every(
          (item) => _isolatedReferences.containsKey(item.id),
        );
  }

  Future<void> _generate() async {
    if (_isGenerating) return;
    final asset = _asset;
    if (asset == null) return;
    if (!_canonicalReferencesReady) {
      _showMessage(
        'Confirme as referências isoladas que ainda estão pendentes.',
      );
      return;
    }
    final request = _buildRequest(asset);
    _startGenerationTimer();
    try {
      final results = await _experimentalV3GenerationService.generateFour(
        request,
        quality: _experimentalQuality,
        canonicalVisualAssets: _isolatedReferences.entries
            .map(
              (entry) => CanonicalVisualAssetBinding(
                canonicalItemId: entry.key,
                asset: entry.value,
              ),
            )
            .toList(),
      );
      const expectedRoles = {
        'hero_commercial',
        'contextual_lifestyle',
        'editorial_craft_detail',
        'concept_campaign',
      };
      final receivedRoles = results
          .map((result) => result.campaignRole)
          .toSet();
      if (results.length != expectedRoles.length ||
          receivedRoles.length != expectedRoles.length ||
          !receivedRoles.containsAll(expectedRoles) ||
          results.any((result) => !result.isCompleted)) {
        throw const ExperimentalV3GenerationException(
          'O Creative Director não retornou as quatro campanhas completas.',
        );
      }
      if (!mounted) return;
      final elapsed = _stopGenerationTimer();
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ExperimentalV3ResultsPage(
            results: Future.value(results),
            elapsed: elapsed,
          ),
        ),
      );
    } on ExperimentalV3GenerationException catch (error) {
      final elapsed = _stopGenerationTimer();
      if (mounted) {
        _showMessage(
          'Não foi possível gerar as quatro campanhas após '
          '${formatGenerationDuration(elapsed)}. ${error.message}',
        );
      }
    } finally {
      _stopGenerationTimer();
      if (mounted) setState(() => _isGenerating = false);
    }
  }

  void _startGenerationTimer() {
    _generationTimer?.cancel();
    _generationStopwatch
      ..reset()
      ..start();
    setState(() {
      _generationElapsed = Duration.zero;
      _isGenerating = true;
    });
    _generationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _generationElapsed = _generationStopwatch.elapsed);
    });
  }

  Duration _stopGenerationTimer() {
    _generationTimer?.cancel();
    _generationTimer = null;
    _generationStopwatch.stop();
    _generationElapsed = _generationStopwatch.elapsed;
    return _generationElapsed;
  }

  void _showMessage(String message) =>
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context) {
    final hasPerson = _category == ProductCategory.person;
    return Scaffold(
      appBar: AppBar(title: const Text('Foto Publicitária')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(22, 8, 22, 32),
          children: [
            Text(
              'Transforme uma foto em campanha',
              style: Theme.of(context).textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Prepare o produto e as regras de preservação antes da geração premium.',
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 24),
            _ImageSelector(
              bytes: _previewBytes,
              uploading: _isUploading,
              uploaded: _asset != null,
              onSelect: _isUploading ? null : _selectImage,
              onRemove: _isUploading ? null : _removeImage,
            ),
            const SizedBox(height: 24),
            if (_isAnalyzingInventory) ...[
              const LinearProgressIndicator(),
              const SizedBox(height: 8),
              const Text('Analisando inventário canônico...'),
              const SizedBox(height: 20),
            ],
            if (_canonicalInventory case final inventory?) ...[
              const _SectionTitle('Referências canônicas do produto'),
              const Text(
                'Confirme uma foto isolada para cada produto detectado.',
              ),
              const SizedBox(height: 8),
              for (final item in inventory.items)
                ListTile(
                  key: ValueKey('canonical-item-${item.id}'),
                  title: Text(item.functionalType),
                  subtitle: Text(
                    'ID: ${item.id} · quantidade: ${item.quantity}',
                  ),
                  leading: Icon(
                    inventory.items.length == 1 ||
                            _isolatedReferences.containsKey(item.id)
                        ? Icons.check_circle
                        : Icons.warning_amber,
                    color:
                        inventory.items.length == 1 ||
                            _isolatedReferences.containsKey(item.id)
                        ? Colors.greenAccent
                        : Colors.amber,
                  ),
                  trailing: inventory.items.length == 1
                      ? null
                      : TextButton(
                          onPressed: _uploadingCanonicalItemId == null
                              ? () => _selectIsolatedReference(item)
                              : null,
                          child: Text(
                            _uploadingCanonicalItemId == item.id
                                ? 'ENVIANDO...'
                                : _isolatedReferences.containsKey(item.id)
                                ? 'SUBSTITUIR'
                                : 'VINCULAR FOTO',
                          ),
                        ),
                ),
              if (!_canonicalReferencesReady)
                const Text(
                  'Faltam referências isoladas. A geração permanece bloqueada.',
                  style: TextStyle(color: Colors.amber),
                ),
              const SizedBox(height: 20),
            ],
            const Text(
              'Creative Director',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _experimentalQuality,
              decoration: const InputDecoration(labelText: 'Qualidade'),
              items: const [
                DropdownMenuItem(value: 'medium', child: Text('Medium')),
                DropdownMenuItem(value: 'high', child: Text('High')),
              ],
              onChanged: _isGenerating
                  ? null
                  : (value) => setState(
                      () => _experimentalQuality = value ?? 'medium',
                    ),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<ProductCategory>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'Categoria'),
              items: ProductCategory.values
                  .map(
                    (item) =>
                        DropdownMenuItem(value: item, child: Text(item.label)),
                  )
                  .toList(),
              onChanged: _isUploading
                  ? null
                  : (value) => setState(() => _category = value ?? _category),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<ProductVisualObjective>(
              initialValue: _objective,
              decoration: const InputDecoration(labelText: 'Objetivo visual'),
              items: ProductVisualObjective.values
                  .map(
                    (item) =>
                        DropdownMenuItem(value: item, child: Text(item.label)),
                  )
                  .toList(),
              onChanged: (value) =>
                  setState(() => _objective = value ?? _objective),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descriptionController,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Descreva o resultado desejado',
                hintText: 'Ex.: cenário sofisticado, luz lateral suave...',
              ),
            ),
            const SizedBox(height: 22),
            const _SectionTitle('Proporção'),
            Wrap(
              spacing: 8,
              children: ['1:1', '4:5', '9:16', '16:9']
                  .map(
                    (ratio) => ChoiceChip(
                      label: Text(ratio),
                      selected: _aspectRatio == ratio,
                      onSelected: (_) => setState(() => _aspectRatio = ratio),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 22),
            const _SectionTitle('Preservar na imagem original'),
            _switch(
              'Produto',
              _preserveProduct,
              (value) => _preserveProduct = value,
            ),
            _switch(
              'Embalagem',
              _preservePackaging,
              (value) => _preservePackaging = value,
            ),
            _switch(
              'Rótulo e texto impresso',
              _preserveLabel,
              (value) => _preserveLabel = value,
            ),
            _switch(
              'Logotipo',
              _preserveLogo,
              (value) => _preserveLogo = value,
            ),
            _switch(
              'Cores',
              _preserveColors,
              (value) => _preserveColors = value,
            ),
            _switch(
              'Proporções',
              _preserveProportions,
              (value) => _preserveProportions = value,
            ),
            if (hasPerson) ...[
              _switch('Rosto', _preserveFace, (value) => _preserveFace = value),
              _switch(
                'Roupa',
                _preserveClothing,
                (value) => _preserveClothing = value,
              ),
            ],
            const SizedBox(height: 22),
            const _SectionTitle('Modo rápido'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children:
                  [
                        (_QuickMode.none, 'Livre'),
                        (_QuickMode.background, 'Somente fundo'),
                        (_QuickMode.scene, 'Somente cenário'),
                        (_QuickMode.lighting, 'Somente iluminação'),
                      ]
                      .map(
                        (option) => ChoiceChip(
                          label: Text(option.$2),
                          selected: _quickMode == option.$1,
                          onSelected: (_) =>
                              setState(() => _quickMode = option.$1),
                        ),
                      )
                      .toList(),
            ),
            const SizedBox(height: 28),
            if (_isGenerating) ...[
              Semantics(
                liveRegion: true,
                label:
                    'Gerando quatro campanhas. Tempo decorrido: '
                    '${formatGenerationDuration(_generationElapsed)}.',
                child: Column(
                  children: [
                    const Text(
                      'Gerando quatro campanhas...',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Tempo decorrido: '
                      '${formatGenerationDuration(_generationElapsed)}',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Isso pode levar alguns minutos.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
            ],
            SizedBox(
              height: 56,
              child: FilledButton.icon(
                onPressed:
                    _asset == null ||
                        _isUploading ||
                        _isGenerating ||
                        _isAnalyzingInventory ||
                        !_canonicalReferencesReady
                    ? null
                    : _generate,
                icon: _isGenerating
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.auto_awesome),
                label: Text(_isGenerating ? 'AGUARDE...' : 'GERAR 4 CAMPANHAS'),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'A geração cria quatro direções publicitárias independentes.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white54, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  Widget _switch(String label, bool value, ValueChanged<bool> update) {
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      value: value,
      onChanged: (next) => setState(() => update(next)),
    );
  }
}

class _ImageSelector extends StatelessWidget {
  const _ImageSelector({
    required this.bytes,
    required this.uploading,
    required this.uploaded,
    required this.onSelect,
    required this.onRemove,
  });

  final Uint8List? bytes;
  final bool uploading;
  final bool uploaded;
  final VoidCallback? onSelect;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    if (bytes == null) {
      return OutlinedButton.icon(
        onPressed: onSelect,
        icon: const Icon(Icons.add_photo_alternate_outlined),
        label: const Padding(
          padding: EdgeInsets.symmetric(vertical: 28),
          child: Text('SELECIONAR FOTO'),
        ),
      );
    }
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          AspectRatio(
            aspectRatio: 4 / 3,
            child: Image.memory(bytes!, fit: BoxFit.contain),
          ),
          if (uploading) const LinearProgressIndicator(),
          ListTile(
            leading: Icon(
              uploaded ? Icons.check_circle : Icons.cloud_upload_outlined,
              color: uploaded ? Colors.greenAccent : null,
            ),
            title: Text(
              uploaded ? 'Foto protegida temporariamente' : 'Enviando foto...',
            ),
            trailing: Wrap(
              children: [
                IconButton(
                  tooltip: 'Substituir foto',
                  onPressed: onSelect,
                  icon: const Icon(Icons.sync),
                ),
                IconButton(
                  tooltip: 'Remover foto',
                  onPressed: onRemove,
                  icon: const Icon(Icons.delete_outline),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium
            ?.copyWith(fontWeight: FontWeight.bold),
      ),
    );
  }
}
