import 'package:flutter/material.dart';

import 'coming_soon_card.dart';
import 'feature_header.dart';

class ToolPlaceholderPage extends StatelessWidget {
  const ToolPlaceholderPage({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(22),
          child: Column(
            children: [
              FeatureHeader(icon: icon, title: title, subtitle: subtitle),
              const SizedBox(height: 28),
              ComingSoonCard(message: message),
            ],
          ),
        ),
      ),
    );
  }
}
