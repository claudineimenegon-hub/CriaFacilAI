import 'package:flutter/material.dart';

import 'navigation/app_shell.dart';
import 'theme/app_theme.dart';

class LogoFacilApp extends StatelessWidget {
  const LogoFacilApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'LogoFácil IA',
      theme: AppTheme.dark,
      home: const AppShell(),
    );
  }
}
