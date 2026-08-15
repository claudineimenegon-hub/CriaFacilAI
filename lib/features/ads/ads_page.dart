import 'package:flutter/material.dart';

import '../../core/widgets/tool_placeholder_page.dart';

class AdsPage extends StatelessWidget {
  const AdsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const ToolPlaceholderPage(
      icon: Icons.campaign_outlined,
      title: 'Criar Anúncio',
      subtitle: 'Prepare peças visuais para campanhas e redes sociais.',
      message: 'Formatos, textos e templates publicitários serão conectados em uma próxima etapa.',
    );
  }
}
