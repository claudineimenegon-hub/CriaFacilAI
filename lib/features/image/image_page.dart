import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/config/app_config.dart';
import '../../core/widgets/feature_header.dart';
import 'data/http_image_generation_service.dart';
import 'domain/image_generation_service.dart';

class ImagePage extends StatefulWidget {
  const ImagePage({super.key, this.service});

  final ImageGenerationService? service;

  @override
  State<ImagePage> createState() => _ImagePageState();
}

class _ImagePageState extends State<ImagePage> {
  final _promptController = TextEditingController();
  late final ImageGenerationService _service;
  List<Uint8List> _generatedImages = const [];
  String? _error;
  bool _isGenerating = false;
  int _imageCount = 1;
  String _aspectRatio = '1:1';

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? HttpImageGenerationService();
  }

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _generate() async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Descreva a imagem que deseja criar.')),
      );
      return;
    }

    setState(() {
      _isGenerating = true;
      _error = null;
    });

    try {
      final images = _imageCount == 1
          ? [await _service.generate(prompt: prompt, aspectRatio: _aspectRatio)]
          : await _service.generateMany(
              prompt: prompt,
              count: _imageCount,
              aspectRatio: _aspectRatio,
            );
      if (!mounted) return;
      setState(() => _generatedImages = images);
    } on ImageGenerationException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isGenerating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Criar imagem')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const FeatureHeader(
                icon: Icons.image,
                title: 'Imagens com sua ideia',
                subtitle: 'Transforme descrições em imagens autorais para seus projetos.',
              ),
              const SizedBox(height: 28),
              TextField(
                controller: _promptController,
                maxLines: 5,
                enabled: !_isGenerating,
                decoration: const InputDecoration(
                  labelText: 'Descreva a imagem',
                  hintText:
                      'Ex.: uma cafeteria acolhedora em estilo editorial...',
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Quantidade de imagens',
                style: Theme.of(context).textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              SegmentedButton<int>(
                segments: List.generate(
                  4,
                  (index) => ButtonSegment<int>(
                    value: index + 1,
                    label: Text('${index + 1}'),
                  ),
                ),
                selected: {_imageCount},
                onSelectionChanged: _isGenerating
                    ? null
                    : (selection) {
                        setState(() => _imageCount = selection.first);
                      },
                showSelectedIcon: false,
              ),
              const SizedBox(height: 16),
              Text(
                'Proporção',
                style: Theme.of(context).textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: ['1:1', '4:5', '9:16', '16:9']
                    .map(
                      (ratio) => ChoiceChip(
                        label: Text(ratio),
                        selected: _aspectRatio == ratio,
                        onSelected: _isGenerating
                            ? null
                            : (_) => setState(() => _aspectRatio = ratio),
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 16),
              SizedBox(
                height: 56,
                child: FilledButton.icon(
                  onPressed: _isGenerating ? null : _generate,
                  icon: _isGenerating
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.auto_awesome),
                  label: Text(
                    _isGenerating
                        ? 'CRIANDO ${_imageCount == 1 ? 'IMAGEM' : 'IMAGENS'}...'
                        : _imageCount == 1
                        ? 'GERAR IMAGEM'
                        : 'GERAR $_imageCount IMAGENS',
                  ),
                ),
              ),
              if (!AppConfig.hasApiBaseUrl && widget.service == null) ...[
                const SizedBox(height: 12),
                const Text(
                  'Servidor ainda não configurado nesta versão.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.amberAccent, fontSize: 12),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 20),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.error_outline,
                          color: Colors.redAccent,
                        ),
                        const SizedBox(width: 12),
                        Expanded(child: Text(_error!)),
                      ],
                    ),
                  ),
                ),
              ],
              if (_generatedImages.isNotEmpty) ...[
                const SizedBox(height: 24),
                if (_generatedImages.length == 1)
                  Align(
                    alignment: Alignment.topCenter,
                    child: ConstrainedBox(
                      key: const ValueKey('single-generated-image-container'),
                      constraints: const BoxConstraints(maxWidth: 800),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(20),
                        child: Image.memory(
                          _generatedImages.first,
                          fit: BoxFit.contain,
                          semanticLabel:
                              'Imagem 1 gerada por inteligência artificial',
                        ),
                      ),
                    ),
                  )
                else
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: _generatedImages.length,
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                    ),
                    itemBuilder: (context, index) => ClipRRect(
                      borderRadius: BorderRadius.circular(20),
                      child: Image.memory(
                        _generatedImages[index],
                        fit: BoxFit.cover,
                        semanticLabel:
                            'Imagem ${index + 1} gerada por inteligência artificial',
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
