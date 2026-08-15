import 'dart:typed_data';

import 'package:flutter/material.dart';

class LogoResultsPage extends StatelessWidget {
  const LogoResultsPage({
    super.key,
    required this.companyName,
    required this.description,
    required this.style,
    required this.images,
  });
  final String companyName;
  final String description;
  final String style;
  final List<Uint8List> images;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Seus logotipos')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                companyName,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                'Estilo: $style',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
              if (description.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  description,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white54),
                ),
              ],
              const SizedBox(height: 28),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: images.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  crossAxisSpacing: 14,
                  mainAxisSpacing: 14,
                ),
                itemBuilder: (_, index) => Card(
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    children: [
                      Expanded(
                        child: Image.memory(
                          images[index],
                          width: double.infinity,
                          fit: BoxFit.cover,
                          semanticLabel: 'Logo ${index + 1} gerado por IA',
                          errorBuilder: (_, _, _) => const Center(
                            child: Padding(
                              padding: EdgeInsets.all(16),
                              child: Text(
                                'Não foi possível exibir este logotipo.',
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(10),
                        child: Text(
                          'Logo ${index + 1}',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Volte para ajustar a descrição e gerar outra opção.',
                    ),
                  ),
                ),
                icon: const Icon(Icons.refresh),
                label: const Text('GERAR NOVAMENTE'),
              ),
              OutlinedButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.edit),
                label: const Text('ALTERAR DESCRIÇÃO'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
