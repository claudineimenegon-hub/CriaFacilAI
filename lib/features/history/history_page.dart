import 'package:flutter/material.dart';

import '../../core/widgets/feature_header.dart';

class HistoryPage extends StatelessWidget {
  const HistoryPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Histórico')),
      body: const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(22),
          child: Column(
            children: [
              FeatureHeader(
                icon: Icons.history,
                title: 'Suas criações',
                subtitle: 'Logos, imagens e vídeos aparecerão aqui.',
              ),
              Spacer(),
              Icon(Icons.inbox_outlined, size: 56, color: Colors.white38),
              SizedBox(height: 12),
              Text(
                'Nenhuma criação ainda',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 6),
              Text(
                'Comece pela aba Logo.',
                style: TextStyle(color: Colors.white54),
              ),
              Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}
