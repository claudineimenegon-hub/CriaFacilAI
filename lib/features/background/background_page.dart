import 'package:flutter/material.dart';

import '../../core/widgets/tool_placeholder_page.dart';

class BackgroundPage extends StatelessWidget {
  const BackgroundPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const ToolPlaceholderPage(
      icon: Icons.layers_clear_outlined,
      title: 'Fundo IA',
      subtitle: 'Remova o fundo ou crie um novo cenário para sua imagem.',
      message: 'Remoção, transparência e geração de fundos serão adicionadas sem alterar o produto principal.',
    );
  }
}
