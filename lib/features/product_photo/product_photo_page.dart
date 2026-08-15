import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/assets/asset_upload_service.dart';
import '../../core/assets/data/http_asset_upload_service.dart';
import '../../core/assets/photo_selection_service.dart';
import '../../core/generation/generation_types.dart';
import 'domain/product_photo_draft.dart';

enum _QuickMode { none, background, scene, lighting }

class ProductPhotoPage extends StatefulWidget {
  const ProductPhotoPage({
    super.key,
    this.uploadService,
    this.photoSelectionService,
  });

  final AssetUploadService? uploadService;
  final PhotoSelectionService? photoSelectionService;

  @override
  State<ProductPhotoPage> createState() => _ProductPhotoPageState();
}

class _ProductPhotoPageState extends State<ProductPhotoPage> {
  final _descriptionController = TextEditingController();
  late final AssetUploadService _uploadService;
  late final PhotoSelectionService _photoSelectionService;
  Uint8List? _previewBytes;
  AssetReference? _asset;
  ProductCategory _category = ProductCategory.general;
  ProductVisualObjective _objective = ProductVisualObjective.premiumStudio;
  String _aspectRatio = '1:1';
  bool _isUploading = false;
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
    _uploadService = widget.uploadService ?? HttpAssetUploadService();
    _photoSelectionService =
        widget.photoSelectionService ?? createPhotoSelectionService();
  }

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _selectImage() async {
    try {
      final selected = await _photoSelectionService.selectImage();
      if (selected == null) return;
      final bytes = selected.bytes;
      final mimeType = _detectSupportedMime(bytes);
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
      if (mounted) setState(() => _asset = asset);
    } on AssetUploadException catch (error) {
      if (mounted) _showMessage(error.message);
    } on PhotoSelectionException catch (error) {
      if (mounted) _showMessage(error.message);
    } on Exception {
      if (mounted) _showMessage('Não foi possível selecionar esta imagem.');
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  String? _detectSupportedMime(Uint8List bytes) {
    if (bytes.length >= 8 &&
        bytes[0] == 0x89 &&
        bytes[1] == 0x50 &&
        bytes[2] == 0x4e &&
        bytes[3] == 0x47 &&
        bytes[4] == 0x0d &&
        bytes[5] == 0x0a &&
        bytes[6] == 0x1a &&
        bytes[7] == 0x0a) {
      return 'image/png';
    }
    if (bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff) {
      return 'image/jpeg';
    }
    return null;
  }

  void _removeImage() => setState(() {
    _previewBytes = null;
    _asset = null;
  });

  void _prepareGeneration() {
    final asset = _asset;
    if (asset == null) return;
    final request =
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
    assert(request.outputSpecification.count == 4);
    _showMessage(
      'Foto preparada com segurança. O provedor foto → imagem será conectado na próxima etapa.',
    );
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
            SizedBox(
              height: 56,
              child: FilledButton.icon(
                onPressed: _asset == null || _isUploading
                    ? null
                    : _prepareGeneration,
                icon: const Icon(Icons.auto_awesome),
                label: const Text('GERAR 4 PROPOSTAS'),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'A geração foto → imagem será ativada após a seleção do provedor apropriado.',
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
