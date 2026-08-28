import 'package:flutter/material.dart';

import '../ads/ads_page.dart';
import '../ai_edit/ai_edit_page.dart';
import '../background/background_page.dart';
import '../image/image_page.dart';
import '../logo/logo_page.dart';
import '../product_photo/product_photo_page.dart';
import '../profile/profile_page.dart';
import '../video/video_page.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  static const _tools = <_CreationTool>[
    _CreationTool(
      icon: Icons.image_outlined,
      title: 'Criar Imagem',
      description: 'Transforme uma descrição em uma imagem com IA.',
      page: ImagePage(),
      available: true,
    ),
    _CreationTool(
      icon: Icons.inventory_2_outlined,
      title: 'Foto Publicitária',
      description: 'Prepare fotos premium para produtos e campanhas.',
      page: ProductPhotoPage(),
      available: true,
    ),
    _CreationTool(
      icon: Icons.auto_fix_high_outlined,
      title: 'Editar Imagem',
      description: 'Ajuste cenários, objetos, cores e iluminação.',
      page: AiEditPage(),
    ),
    _CreationTool(
      icon: Icons.layers_clear_outlined,
      title: 'Fundo IA',
      description: 'Remova ou crie fundos para suas imagens.',
      page: BackgroundPage(),
    ),
    _CreationTool(
      icon: Icons.movie_creation_outlined,
      title: 'Criar Vídeo',
      description: 'Planeje vídeos a partir de texto ou imagem.',
      page: VideoPage(),
    ),
    _CreationTool(
      icon: Icons.campaign_outlined,
      title: 'Criar Anúncio',
      description: 'Crie peças para campanhas e redes sociais.',
      page: AdsPage(),
    ),
    _CreationTool(
      icon: Icons.auto_awesome_outlined,
      title: 'Criar Logo',
      description: 'Gere quatro opções de identidade para sua marca.',
      page: LogoPage(),
      available: true,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'CriaFácilAI',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            tooltip: 'Perfil e planos',
            onPressed: () => _open(context, const ProfilePage()),
            icon: const Icon(Icons.person_outline),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 760 ? 3 : 2;
            return CustomScrollView(
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(22, 12, 22, 22),
                  sliver: SliverList.list(
                    children: [
                      Text(
                        'Crie com inteligência artificial',
                        style: Theme.of(context).textTheme.headlineMedium
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'Imagens, campanhas e conteúdo visual em uma experiência simples.',
                        style: TextStyle(color: Colors.white70, height: 1.4),
                      ),
                      const SizedBox(height: 26),
                      Text(
                        'O que você quer criar?',
                        style: Theme.of(context).textTheme.titleLarge
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(22, 0, 22, 32),
                  sliver: SliverGrid(
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: columns == 3 ? 1.05 : 0.9,
                    ),
                    delegate: SliverChildBuilderDelegate(
                      (context, index) => _ToolCard(
                        tool: _tools[index],
                        onTap: () => _open(context, _tools[index].page),
                      ),
                      childCount: _tools.length,
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  static Future<void> _open(BuildContext context, Widget page) {
    return Navigator.of(context)
        .push(MaterialPageRoute<void>(builder: (_) => page));
  }
}

class _ToolCard extends StatelessWidget {
  const _ToolCard({required this.tool, required this.onTap});

  final _CreationTool tool;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                tool.icon,
                size: 34,
                color: Theme.of(context).colorScheme.primary,
              ),
              const Spacer(),
              Text(
                tool.title,
                maxLines: 2,
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 6),
              Text(
                tool.description,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white60, fontSize: 12),
              ),
              const SizedBox(height: 10),
              Text(
                tool.available ? 'Disponível' : 'Em breve',
                style: TextStyle(
                  color: tool.available
                      ? Theme.of(context).colorScheme.primary
                      : Colors.white38,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CreationTool {
  const _CreationTool({
    required this.icon,
    required this.title,
    required this.description,
    required this.page,
    this.available = false,
  });

  final IconData icon;
  final String title;
  final String description;
  final Widget page;
  final bool available;
}
