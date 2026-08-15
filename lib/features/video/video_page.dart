import 'package:flutter/material.dart';

import '../../core/widgets/coming_soon_card.dart';
import '../../core/widgets/feature_header.dart';

class VideoPage extends StatelessWidget {
  const VideoPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Criar vídeo')),
      body: const SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(22),
          child: Column(
            children: [
              FeatureHeader(
                icon: Icons.movie_creation,
                title: 'Vídeos com IA',
                subtitle:
                    'Planeje cenas curtas a partir de texto ou de uma imagem.',
              ),
              SizedBox(height: 28),
              TextField(
                maxLines: 5,
                decoration: InputDecoration(
                  labelText: 'Descreva a cena',
                  hintText: 'Ex.: movimento suave de câmera sobre uma cidade futurista...',
                ),
              ),
              SizedBox(height: 20),
              ComingSoonCard(
                message: 'Este módulo está preparado para receber o fluxo assíncrono de geração de vídeo.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
