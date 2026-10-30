import 'package:flutter/material.dart';

import '../../core/sharing/image_share_service.dart';
import 'domain/experimental_v3_generation_service.dart';
import 'generation_duration_formatter.dart';
import 'image_viewer_page.dart';

const _fileNames = <String, String>{
  'hero_commercial': 'hero-comercial',
  'contextual_lifestyle': 'lifestyle',
  'editorial_craft_detail': 'detalhes-editorial',
  'concept_campaign': 'campanha-conceitual',
};

const _roles = <String, String>{
  'hero_commercial': 'Hero Comercial',
  'contextual_lifestyle': 'Lifestyle',
  'editorial_craft_detail': 'Detalhes / Editorial',
  'concept_campaign': 'Campanha Conceitual',
};

class ExperimentalV3ResultsPage extends StatelessWidget {
  const ExperimentalV3ResultsPage({
    super.key,
    required this.results,
    required this.elapsed,
  });

  final Future<List<ExperimentalV3ImageResult>> results;
  final Duration elapsed;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Creative Director')),
      body: SafeArea(
        child: FutureBuilder<List<ExperimentalV3ImageResult>>(
          future: results,
          builder: (context, snapshot) {
            final values = snapshot.data;
            final error = snapshot.hasError;
            final stamp = DateTime.now().millisecondsSinceEpoch;
            final ready = <({String role, ShareableImage image})>[
              for (final role in _roles.keys)
                if (values
                        ?.where((item) => item.campaignRole == role)
                        .firstOrNull
                    case final result?
                    when result.isCompleted && result.imageBytes != null)
                  (
                    role: role,
                    image: ShareableImage(
                      bytes: result.imageBytes!,
                      fileName: 'criafacil-${_fileNames[role]}-$stamp',
                    ),
                  ),
            ];
            void openViewer(String role) {
              final start = ready.indexWhere((item) => item.role == role);
              if (start < 0) return;
              ImageViewerPage.open(
                context,
                images: [for (final item in ready) item.image],
                titles: [for (final item in ready) _roles[item.role]!],
                initialIndex: start,
              );
            }

            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
                  child: Row(
                    children: [
                      if (snapshot.connectionState ==
                          ConnectionState.waiting) ...[
                        const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Text(
                            'Preparando produto • Criando direção criativa • Gerando imagens',
                          ),
                        ),
                      ] else if (error)
                        const Expanded(
                          child: Text(
                            'O teste não pôde ser concluído. Tente novamente.',
                            style: TextStyle(color: Colors.orangeAccent),
                          ),
                        )
                      else ...[
                        Expanded(
                          child: Text(
                            'Quatro campanhas concluídas em '
                            '${formatGenerationDuration(elapsed)}',
                            style: const TextStyle(color: Colors.greenAccent),
                          ),
                        ),
                        if (ready.isNotEmpty)
                          TextButton.icon(
                            onPressed: () => openViewer(ready.first.role),
                            icon: const Icon(Icons.download),
                            label: const Text('Baixar'),
                          ),
                      ],
                    ],
                  ),
                ),
                Expanded(
                  child: GridView.builder(
                    padding: const EdgeInsets.all(20),
                    itemCount: 4,
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: MediaQuery.sizeOf(context).width >= 900
                          ? 4
                          : 2,
                      crossAxisSpacing: 14,
                      mainAxisSpacing: 14,
                      childAspectRatio: 0.78,
                    ),
                    itemBuilder: (context, index) {
                      final role = _roles.keys.elementAt(index);
                      final result = values
                          ?.where((item) => item.campaignRole == role)
                          .firstOrNull;
                      return _ResultCard(
                        title: _roles[role]!,
                        loading:
                            snapshot.connectionState == ConnectionState.waiting,
                        result: result,
                        globalError: error,
                        onTap: () => openViewer(role),
                      );
                    },
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({
    required this.title,
    required this.loading,
    required this.result,
    required this.globalError,
    this.onTap,
  });
  final VoidCallback? onTap;
  final String title;
  final bool loading;
  final ExperimentalV3ImageResult? result;
  final bool globalError;

  @override
  Widget build(BuildContext context) {
    final image = result?.imageBytes;
    final tappable = !loading && image != null && result!.isCompleted;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: tappable ? onTap : null,
        child: Column(
        children: [
          Expanded(
            child: loading
                ? const Center(child: CircularProgressIndicator())
                : image != null && result!.isCompleted
                ? Image.memory(
                    image,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const Center(
                      child: Text(
                        'Não foi possível exibir esta imagem.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                : Center(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        globalError
                            ? 'Geração interrompida.'
                            : result?.errorMessage ?? 'Proposta indisponível.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
          ),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Text(
              loading
                  ? '$title — aguardando...'
                  : result?.isCompleted == true
                  ? '$title — concluído'
                  : '$title — erro',
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          if (tappable)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text(
                'Toque para ampliar',
                style: TextStyle(fontSize: 11, color: Colors.white54),
              ),
            ),
        ],
      ),
      ),
    );
  }
}
