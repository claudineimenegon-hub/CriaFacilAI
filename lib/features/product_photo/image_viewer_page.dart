import 'package:flutter/material.dart';

import '../../core/sharing/image_share_service.dart';

/// Tela cheia: deslizar entre as fotos, pinça/duplo toque para zoom,
/// baixar e compartilhar.
class ImageViewerPage extends StatefulWidget {
  const ImageViewerPage({
    super.key,
    required this.images,
    required this.titles,
    this.initialIndex = 0,
    this.shareService,
  }) : assert(images.length == titles.length);

  final List<ShareableImage> images;
  final List<String> titles;
  final int initialIndex;
  final ImageShareService? shareService;

  static Future<void> open(
    BuildContext context, {
    required List<ShareableImage> images,
    required List<String> titles,
    int initialIndex = 0,
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => ImageViewerPage(
          images: images,
          titles: titles,
          initialIndex: initialIndex,
        ),
      ),
    );
  }

  @override
  State<ImageViewerPage> createState() => _ImageViewerPageState();
}

class _ImageViewerPageState extends State<ImageViewerPage> {
  late final PageController _pageController;
  late final ImageShareService _shareService;
  late final List<TransformationController> _zoomControllers;
  late int _index;
  bool _zoomed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex;
    _pageController = PageController(initialPage: _index);
    _shareService = widget.shareService ?? createImageShareService();
    _zoomControllers = List.generate(
      widget.images.length,
      (_) => TransformationController(),
    );
  }

  @override
  void dispose() {
    _pageController.dispose();
    for (final controller in _zoomControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } on ImageShareException catch (error) {
      if (mounted) _showMessage(error.message);
    } catch (_) {
      if (mounted) _showMessage('Não foi possível concluir agora.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download() => _run(() async {
    await _shareService.download(widget.images[_index]);
    if (mounted) _showMessage('Foto baixada.');
  });

  Future<void> _downloadAll() => _run(() async {
    for (final image in widget.images) {
      await _shareService.download(image);
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    if (mounted) _showMessage('${widget.images.length} fotos baixadas.');
  });

  Future<void> _share({bool all = false}) => _run(() async {
    await _shareService.share(
      all ? widget.images : [widget.images[_index]],
    );
  });

  void _onZoomChanged(int page) {
    final scale = _zoomControllers[page].value.getMaxScaleOnAxis();
    final zoomed = scale > 1.01;
    if (zoomed != _zoomed) setState(() => _zoomed = zoomed);
  }

  void _toggleZoom(int page, TapDownDetails details) {
    final controller = _zoomControllers[page];
    if (controller.value.getMaxScaleOnAxis() > 1.01) {
      controller.value = Matrix4.identity();
    } else {
      const scale = 2.5;
      final position = details.localPosition;
      controller.value = Matrix4.identity()
        ..translateByDouble(
          -position.dx * (scale - 1),
          -position.dy * (scale - 1),
          0,
          1,
        )
        ..scaleByDouble(scale, scale, 1, 1);
    }
    _onZoomChanged(page);
  }

  @override
  Widget build(BuildContext context) {
    final canShare = _shareService.canShareFiles;
    final total = widget.images.length;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(
          total > 1
              ? '${widget.titles[_index]} (${_index + 1}/$total)'
              : widget.titles[_index],
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (total > 1)
            PopupMenuButton<String>(
              tooltip: 'Todas as fotos',
              icon: const Icon(Icons.more_vert),
              enabled: !_busy,
              onSelected: (value) =>
                  value == 'download' ? _downloadAll() : _share(all: true),
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'download',
                  child: ListTile(
                    leading: Icon(Icons.download),
                    title: Text('Baixar todas'),
                  ),
                ),
                if (canShare)
                  const PopupMenuItem(
                    value: 'share',
                    child: ListTile(
                      leading: Icon(Icons.share),
                      title: Text('Compartilhar todas'),
                    ),
                  ),
              ],
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: total,
                // Com zoom, o arrasto move a foto em vez de trocar de página.
                physics: _zoomed
                    ? const NeverScrollableScrollPhysics()
                    : const PageScrollPhysics(),
                onPageChanged: (page) => setState(() {
                  _zoomControllers[_index].value = Matrix4.identity();
                  _index = page;
                  _zoomed = false;
                }),
                itemBuilder: (context, page) {
                  TapDownDetails? lastTap;
                  return GestureDetector(
                    onDoubleTapDown: (details) => lastTap = details,
                    onDoubleTap: () {
                      if (lastTap != null) _toggleZoom(page, lastTap!);
                    },
                    child: InteractiveViewer(
                      transformationController: _zoomControllers[page],
                      minScale: 1,
                      maxScale: 6,
                      onInteractionEnd: (_) => _onZoomChanged(page),
                      child: Center(
                        child: Image.memory(
                          widget.images[page].bytes,
                          fit: BoxFit.contain,
                          semanticLabel: widget.titles[page],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: Row(
                children: [
                  Expanded(
                    child: FilledButton.tonalIcon(
                      onPressed: _busy ? null : _download,
                      icon: const Icon(Icons.download),
                      label: const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: Text('Baixar'),
                      ),
                    ),
                  ),
                  if (canShare) ...[
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _share,
                        icon: const Icon(Icons.share),
                        label: const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Text('Compartilhar'),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const Text(
              'Toque duas vezes ou use dois dedos para dar zoom',
              style: TextStyle(color: Colors.white54, fontSize: 12),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
