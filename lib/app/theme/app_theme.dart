import 'package:flutter/material.dart';

abstract final class AppTheme {
  static ThemeData get dark {
    final colors = ColorScheme.fromSeed(
      seedColor: const Color(0xFF7467F0),
      brightness: Brightness.dark,
      surface: const Color(0xFF171923),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: colors,
      scaffoldBackgroundColor: const Color(0xFF0F1117),
      appBarTheme: const AppBarTheme(backgroundColor: Colors.transparent),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF171923),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
      ),
      cardTheme: CardThemeData(
        color: const Color(0xFF171923),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
    );
  }
}
