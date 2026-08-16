import 'dart:typed_data';

import 'package:flutter/material.dart';

class ProductPhotoResultsPage extends StatelessWidget {
  const ProductPhotoResultsPage({
    super.key,
    required this.images,
    required this.title,
  }) : assert(images.length == 4);

  final List<Uint8List> images;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Propostas publicitárias')),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 900 ? 4 : 2;
            return GridView.builder(
              padding: const EdgeInsets.all(20),
              itemCount: images.length,
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                crossAxisSpacing: 14,
                mainAxisSpacing: 14,
                childAspectRatio: 0.82,
              ),
              itemBuilder: (context, index) => Card(
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => _showLargeImage(context, images[index], index),
                  child: Column(
                    children: [
                      Expanded(
                        child: Image.memory(
                          images[index],
                          width: double.infinity,
                          fit: BoxFit.cover,
                          semanticLabel: 'Proposta publicitária ${index + 1}',
                          errorBuilder: (_, _, _) => const Center(
                            child: Padding(
                              padding: EdgeInsets.all(16),
                              child: Text(
                                'Não foi possível exibir esta proposta.',
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(10),
                        child: Text(
                          'Proposta ${index + 1}',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  void _showLargeImage(BuildContext context, Uint8List image, int index) {
    showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900, maxHeight: 800),
          child: Stack(
            children: [
              InteractiveViewer(
                minScale: 0.8,
                maxScale: 4,
                child: Image.memory(
                  image,
                  fit: BoxFit.contain,
                  semanticLabel: '$title, proposta ${index + 1} ampliada',
                ),
              ),
              Positioned(
                right: 8,
                top: 8,
                child: IconButton.filledTonal(
                  tooltip: 'Fechar',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
