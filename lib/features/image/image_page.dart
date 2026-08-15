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
  Uint8List? _generatedImage;
  String? _error;
  bool _isGenerating = false;

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
      final image = await _service.generate(prompt: prompt);
      if (!mounted) return;
      setState(() => _generatedImage = image);
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
                    _isGenerating ? 'CRIANDO IMAGEM...' : 'GERAR IMAGEM',
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
              if (_generatedImage != null) ...[
                const SizedBox(height: 24),
                ClipRRect(
                  borderRadius: BorderRadius.circular(20),
                  child: Image.memory(
                    _generatedImage!,
                    fit: BoxFit.cover,
                    semanticLabel: 'Imagem gerada por inteligência artificial',
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
