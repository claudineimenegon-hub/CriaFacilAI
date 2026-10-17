import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'domain/ad_copy.dart';

class AdCopyResultsPage extends StatelessWidget {
  const AdCopyResultsPage({
    super.key,
    required this.result,
    required this.productName,
    this.image,
  });

  final AdCopyResult result;
  final String productName;
  final Uint8List? image;

  static Future<void> copy(BuildContext context, String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text('Texto copiado!')));
  }

  @override
  Widget build(BuildContext context) {
    final tabs = [
      for (final platform in result.platforms) Tab(text: platform.label),
      const Tab(text: 'Descrição'),
      const Tab(text: 'Produto'),
    ];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(productName, overflow: TextOverflow.ellipsis),
          bottom: TabBar(isScrollable: true, tabs: tabs),
        ),
        body: SafeArea(
          child: Column(
            children: [
              if (result.warnings.isNotEmpty) _WarningsBanner(result.warnings),
              Expanded(
                child: TabBarView(
                  children: [
                    for (final platform in result.platforms)
                      _PlatformTab(platform: platform),
                    _DescriptionTab(result: result),
                    _ProductTab(result: result, image: image),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WarningsBanner extends StatelessWidget {
  const _WarningsBanner(this.warnings);
  final List<AdCopyWarning> warnings;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.errorContainer,
      child: ExpansionTile(
        leading: Icon(Icons.warning_amber_rounded, color: scheme.onErrorContainer),
        title: Text(
          'Revise ${warnings.length} ponto(s) antes de publicar',
          style: TextStyle(color: scheme.onErrorContainer),
        ),
        children: [
          for (final w in warnings)
            ListTile(
              dense: true,
              title: Text(w.message, style: TextStyle(color: scheme.onErrorContainer)),
              subtitle: Text(w.where, style: TextStyle(color: scheme.onErrorContainer)),
            ),
        ],
      ),
    );
  }
}

class _PlatformTab extends StatelessWidget {
  const _PlatformTab({required this.platform});
  final AdCopyPlatformResult platform;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: platform.variants.length,
      separatorBuilder: (_, _) => const SizedBox(height: 14),
      itemBuilder: (context, index) {
        final v = platform.variants[index];
        final textTheme = Theme.of(context).textTheme;
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Variação ${index + 1}${v.angle.isEmpty ? '' : ' · ${v.angle}'}',
                        style: textTheme.labelLarge,
                      ),
                    ),
                    FilledButton.tonalIcon(
                      onPressed: () => AdCopyResultsPage.copy(context, v.fullText),
                      icon: const Icon(Icons.copy, size: 18),
                      label: const Text('Copiar'),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                if (v.headline.isNotEmpty)
                  Text(
                    v.headline,
                    style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                  ),
                const SizedBox(height: 8),
                SelectableText(v.caption),
                if (v.cta.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(v.cta, style: const TextStyle(fontWeight: FontWeight.w600)),
                ],
                if (v.hashtags.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  SelectableText(
                    v.hashtags.join(' '),
                    style: TextStyle(color: Theme.of(context).colorScheme.primary),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DescriptionTab extends StatelessWidget {
  const _DescriptionTab({required this.result});
  final AdCopyResult result;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton.tonalIcon(
            onPressed: () => AdCopyResultsPage.copy(context, result.fullDescription),
            icon: const Icon(Icons.copy, size: 18),
            label: const Text('Copiar tudo'),
          ),
        ),
        const SizedBox(height: 8),
        SelectableText(
          result.descriptionTitle,
          style: textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        SelectableText(result.descriptionShort, style: textTheme.titleSmall),
        const SizedBox(height: 14),
        SelectableText(result.descriptionLong),
        const SizedBox(height: 14),
        for (final bullet in result.descriptionBullets)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text('• $bullet'),
          ),
      ],
    );
  }
}

class _ProductTab extends StatelessWidget {
  const _ProductTab({required this.result, this.image});
  final AdCopyResult result;
  final Uint8List? image;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (image != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: AspectRatio(
              aspectRatio: 4 / 3,
              child: Image.memory(image!, fit: BoxFit.contain),
            ),
          ),
        const SizedBox(height: 16),
        Text('Como o robô leu a peça', style: textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(result.whatItIs),
        if (result.emotions.isNotEmpty) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [for (final e in result.emotions) Chip(label: Text(e))],
          ),
        ],
        if (result.idealCustomer.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Cliente ideal', style: textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(result.idealCustomer),
        ],
        if (result.imageTextIdeas.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Frases para colocar na arte', style: textTheme.titleMedium),
          const SizedBox(height: 6),
          for (final idea in result.imageTextIdeas)
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text(idea),
              trailing: IconButton(
                tooltip: 'Copiar',
                icon: const Icon(Icons.copy, size: 18),
                onPressed: () => AdCopyResultsPage.copy(context, idea),
              ),
            ),
        ],
      ],
    );
  }
}
