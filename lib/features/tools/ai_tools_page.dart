import 'package:flutter/material.dart';

import '../../core/widgets/coming_soon_card.dart';
import '../../core/widgets/feature_header.dart';

class AiToolsPage extends StatelessWidget {
  const AiToolsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ferramentas IA')),
      body: const SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(22),
          child: Column(
            children: [
              FeatureHeader(
                icon: Icons.auto_fix_high,
                title: 'Ferramentas inteligentes',
                subtitle: 'Edição, fundos, melhoria e recursos especializados em um só lugar.',
              ),
              SizedBox(height: 28),
              ComingSoonCard(
                message: 'As ferramentas serão ativadas progressivamente sobre a arquitetura de geração existente.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
