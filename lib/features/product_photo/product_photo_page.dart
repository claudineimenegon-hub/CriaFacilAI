import 'package:flutter/material.dart';

import '../../core/widgets/tool_placeholder_page.dart';

class ProductPhotoPage extends StatelessWidget {
  const ProductPhotoPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const ToolPlaceholderPage(
      icon: Icons.inventory_2_outlined,
      title: 'Foto Publicitária',
      subtitle: 'Transforme fotos simples em imagens comerciais premium.',
      message: 'A estrutura está pronta para receber upload, preservação do produto e quatro variações publicitárias.',
    );
  }
}
