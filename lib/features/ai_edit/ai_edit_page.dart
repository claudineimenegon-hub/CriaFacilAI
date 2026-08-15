import 'package:flutter/material.dart';

import '../../core/widgets/tool_placeholder_page.dart';

class AiEditPage extends StatelessWidget {
  const AiEditPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const ToolPlaceholderPage(
      icon: Icons.auto_fix_high_outlined,
      title: 'Editar Imagem',
      subtitle: 'Descreva alterações e preserve o que importa na foto.',
      message: 'A edição por imagem, prompt e máscara será integrada em uma próxima etapa.',
    );
  }
}
