import 'package:flutter/material.dart';

import '../../core/widgets/feature_header.dart';
import '../image/data/http_image_generation_service.dart';
import '../image/domain/image_generation_service.dart';
import 'logo_results_page.dart';

class LogoPage extends StatefulWidget {
  const LogoPage({super.key, this.service});

  final ImageGenerationService? service;

  @override
  State<LogoPage> createState() => _LogoPageState();
}

class _LogoPageState extends State<LogoPage> {
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _styles = const [
    'Moderno',
    'Luxo',
    'Minimalista',
    '3D',
    'Mascote',
    'Vintage',
  ];
  String _selectedStyle = 'Moderno';
  late final ImageGenerationService _service;
  bool _isGenerating = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? HttpImageGenerationService();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _generateLogo() async {
    final companyName = _nameController.text.trim();
    final description = _descriptionController.text.trim();
    if (companyName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Digite o nome da empresa.')),
      );
      return;
    }

    final prompt = [
      'Crie um logotipo profissional para a empresa "$companyName".',
      'Estilo visual: $_selectedStyle.',
      if (description.isNotEmpty) 'Descrição e preferências: $description.',
      'Apresente apenas o logotipo, centralizado, sem mockup e sem marca-d’água.',
    ].join(' ');

    setState(() => _isGenerating = true);
    try {
      final images = await _service.generateMany(prompt: prompt, count: 4);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => LogoResultsPage(
            companyName: companyName,
            description: description,
            style: _selectedStyle,
            images: images,
          ),
        ),
      );
    } on ImageGenerationException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _isGenerating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'LogoFácil IA',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(22, 8, 22, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const FeatureHeader(
                icon: Icons.auto_awesome,
                title: 'Crie sua marca com IA',
                subtitle: 'Descreva sua empresa e transforme sua ideia em um logotipo profissional.',
              ),
              const SizedBox(height: 28),
              TextField(
                controller: _nameController,
                enabled: !_isGenerating,
                decoration: const InputDecoration(
                  labelText: 'Nome da empresa',
                  hintText: 'Ex.: Menegon Express',
                  prefixIcon: Icon(Icons.business),
                ),
              ),
              const SizedBox(height: 18),
              TextField(
                controller: _descriptionController,
                enabled: !_isGenerating,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Como você imagina o logotipo?',
                  hintText: 'Ex.: elegante, azul escuro e dourado...',
                  prefixIcon: Icon(Icons.edit_outlined),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Escolha um estilo',
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _styles
                    .map(
                      (style) => ChoiceChip(
                        label: Text(style),
                        selected: style == _selectedStyle,
                        onSelected: _isGenerating
                            ? null
                            : (_) => setState(() => _selectedStyle = style),
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 32),
              SizedBox(
                height: 56,
                child: FilledButton.icon(
                  onPressed: _isGenerating ? null : _generateLogo,
                  icon: _isGenerating
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.auto_awesome),
                  label: Text(
                    _isGenerating ? 'CRIANDO LOGOTIPO...' : 'GERAR LOGOTIPO',
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'A geração pode levar alguns segundos.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Colors.white54),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
