import 'package:flutter/material.dart';

import '../../core/widgets/coming_soon_card.dart';
import '../../core/widgets/feature_header.dart';

class TemplatesPage extends StatelessWidget {
  const TemplatesPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Modelos')),
      body: const SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(22),
          child: Column(
            children: [
              FeatureHeader(
                icon: Icons.grid_view,
                title: 'Modelos para começar rápido',
                subtitle: 'Estruturas prontas para e-commerce, campanhas e redes sociais.',
              ),
              SizedBox(height: 28),
              ComingSoonCard(
                message: 'O catálogo de modelos terá categorias, proporções, estilos e prompts-base.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
