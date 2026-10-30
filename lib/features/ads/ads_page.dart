import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/assets/asset_upload_service.dart';
import '../../core/assets/data/http_asset_upload_service.dart';
import '../../core/assets/photo_selection_service.dart';
import '../../core/generation/generation_types.dart';
import '../../core/widgets/feature_header.dart';
import 'ad_copy_results_page.dart';
import 'data/http_ad_copy_service.dart';
import 'domain/ad_copy.dart';

class AdsPage extends StatefulWidget {
  const AdsPage({
    super.key,
    this.adCopyService,
    this.uploadService,
    this.photoSelectionService,
  });

  final AdCopyService? adCopyService;
  final AssetUploadService? uploadService;
  final PhotoSelectionService? photoSelectionService;

  @override
  State<AdsPage> createState() => _AdsPageState();
}

class _AdsPageState extends State<AdsPage> {
  late final AdCopyService _adCopyService;
  late final AssetUploadService _uploadService;
  late final PhotoSelectionService _photoSelectionService;

  final _nameController = TextEditingController();
  final _priceController = TextEditingController();
  final _detailsController = TextEditingController();
  final _offerController = TextEditingController();
  final _brandController = TextEditingController();
  final _contactController = TextEditingController();

  Uint8List? _previewBytes;
  AssetReference? _asset;
  bool _isUploading = false;
  bool _isGenerating = false;

  AdObjective _objective = AdObjective.venda;
  AdTone _tone = AdTone.elegante;
  final Set<AdPlatform> _platforms = {AdPlatform.instagram, AdPlatform.whatsapp};
  int _variants = 2;

  @override
  void initState() {
    super.initState();
    _adCopyService = widget.adCopyService ?? HttpAdCopyService();
    _uploadService = widget.uploadService ?? HttpAssetUploadService();
    _photoSelectionService =
        widget.photoSelectionService ?? createPhotoSelectionService();
  }

  @override
  void dispose() {
    for (final controller in [
      _nameController,
      _priceController,
      _detailsController,
      _offerController,
      _brandController,
      _contactController,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _selectImage() async {
    try {
      final selected = await _photoSelectionService.selectImage();
      if (selected == null) return;
      final mimeType = detectSupportedImageMime(selected.bytes);
      if (mimeType == null) {
        _showMessage('Selecione uma imagem PNG ou JPEG válida.');
        return;
      }
      setState(() {
        _previewBytes = selected.bytes;
        _asset = null;
        _isUploading = true;
      });
      final asset = await _uploadService.uploadImage(
        bytes: selected.bytes,
        mimeType: mimeType,
      );
      if (mounted) setState(() => _asset = asset);
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
  });

  Future<void> _generate() async {
    FocusScope.of(context).unfocus();
    final name = _nameController.text.trim();
    final details = _detailsController.text.trim();
    if (name.length < 2) {
      _showMessage('Informe o nome do produto.');
      return;
    }
    if (_asset == null && details.isEmpty) {
      _showMessage('Envie uma foto ou descreva os detalhes do produto.');
      return;
    }
    if (_platforms.isEmpty) {
      _showMessage('Escolha ao menos uma plataforma.');
      return;
    }
    setState(() => _isGenerating = true);
    try {
      final result = await _adCopyService.generate(
        AdCopyRequest(
          productName: name,
          price: _priceController.text.trim(),
          details: details,
          offer: _offerController.text.trim(),
          brandName: _brandController.text.trim(),
          contact: _contactController.text.trim(),
          objective: _objective,
          tone: _tone,
          platforms: Set.of(_platforms),
          variants: _variants,
          inputAssetIds: [if (_asset != null) _asset!.id],
        ),
      );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => AdCopyResultsPage(
            result: result,
            productName: name,
            image: _previewBytes,
          ),
        ),
      );
    } on AdCopyException catch (error) {
      if (mounted) _showMessage(error.message);
    } finally {
      if (mounted) setState(() => _isGenerating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = _isUploading || _isGenerating;
    return Scaffold(
      appBar: AppBar(title: const Text('Criar Anúncio')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(22),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const FeatureHeader(
                    icon: Icons.campaign_outlined,
                    title: 'Robô de anúncios',
                    subtitle:
                        'Envie a foto da peça e receba títulos, legendas, hashtags e descrição prontos para cada rede.',
                  ),
                  const SizedBox(height: 24),
                  const _SectionTitle('1. Foto do produto (recomendado)'),
                  _PhotoPicker(
                    bytes: _previewBytes,
                    uploading: _isUploading,
                    uploaded: _asset != null,
                    onSelect: busy ? null : _selectImage,
                    onRemove: busy ? null : _removeImage,
                  ),
                  const SizedBox(height: 24),
                  const _SectionTitle('2. Sobre o produto'),
                  TextField(
                    controller: _nameController,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Nome do produto *',
                      hintText: 'Ex.: Brinco Gota Cristal',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _detailsController,
                    maxLines: 3,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Detalhes (material, banho, pedras, tamanho)',
                      hintText: 'Ex.: banhado a ouro 18k, zircônia, 3 cm',
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _priceController,
                          decoration: const InputDecoration(
                            labelText: 'Preço',
                            hintText: 'R\$ 89,90',
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _offerController,
                          decoration: const InputDecoration(
                            labelText: 'Oferta',
                            hintText: 'Ex.: 3x sem juros',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _brandController,
                          decoration: const InputDecoration(
                            labelText: 'Marca',
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _contactController,
                          decoration: const InputDecoration(
                            labelText: 'Contato / link',
                            hintText: 'WhatsApp ou site',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Preço, oferta e material só aparecem no anúncio se você informar. O robô não inventa.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 24),
                  const _SectionTitle('3. Objetivo'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final objective in AdObjective.values)
                        ChoiceChip(
                          label: Text(objective.label),
                          selected: _objective == objective,
                          onSelected: busy
                              ? null
                              : (_) => setState(() => _objective = objective),
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const _SectionTitle('4. Tom de voz'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final tone in AdTone.values)
                        ChoiceChip(
                          label: Text(tone.label),
                          selected: _tone == tone,
                          onSelected: busy
                              ? null
                              : (_) => setState(() => _tone = tone),
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const _SectionTitle('5. Onde vai publicar'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final platform in AdPlatform.values)
                        FilterChip(
                          label: Text(platform.label),
                          selected: _platforms.contains(platform),
                          onSelected: busy
                              ? null
                              : (selected) => setState(() {
                                  if (selected) {
                                    _platforms.add(platform);
                                  } else {
                                    _platforms.remove(platform);
                                  }
                                }),
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const _SectionTitle('6. Variações por rede'),
                  SegmentedButton<int>(
                    segments: const [
                      ButtonSegment(value: 1, label: Text('1')),
                      ButtonSegment(value: 2, label: Text('2')),
                      ButtonSegment(value: 3, label: Text('3')),
                    ],
                    selected: {_variants},
                    onSelectionChanged: busy
                        ? null
                        : (value) => setState(() => _variants = value.first),
                  ),
                  const SizedBox(height: 28),
                  FilledButton.icon(
                    onPressed: busy ? null : _generate,
                    icon: _isGenerating
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.auto_awesome),
                    label: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Text(
                        _isGenerating ? 'Criando anúncio...' : 'CRIAR ANÚNCIO',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PhotoPicker extends StatelessWidget {
  const _PhotoPicker({
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
          padding: EdgeInsets.symmetric(vertical: 24),
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
            title: Text(uploaded ? 'Foto pronta' : 'Enviando foto...'),
            trailing: Wrap(
              children: [
                IconButton(
                  tooltip: 'Trocar foto',
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
        style: Theme.of(
          context,
        ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
      ),
    );
  }
}
