import 'package:flutter/material.dart';

/// Colors lifted straight from santu_billing.css so the mobile screen reads
/// as the same app, not a reskin. Keep in sync with
/// santu_hardware/public/css/santu_billing.css if that palette changes.
class SantuColors {
  static const bg = Color(0xFFF8FAFC); // Crisp Slate 50
  static const card = Color(0xFFFFFFFF);
  static const border = Color(0xFFE2E8F0);
  static const borderLight = Color(0xFFF1F5F9);
  static const textDark = Color(0xFF0F172A);
  static const textMuted = Color(0xFF64748B);
  static const textFaint = Color(0xFF94A3B8);
  static const blue = Color(0xFF2563EB); // Vibrant primary
  static const blueLight = Color(0xFF3B82F6);
  static const blueBg = Color(0xFFEFF6FF);
  static const green = Color(0xFF059669); // Premium emerald
  static const greenLight = Color(0xFF10B981);
  static const greenBg = Color(0xFFECFDF5);
  static const amber = Color(0xFFD97706);
  static const amberBg = Color(0xFFFFFBEB);
  static const amberBorder = Color(0xFFFDE68A);
  static const red = Color(0xFFE11D48);
  static const redBg = Color(0xFFFFF1F2);
}

ThemeData santuTheme() {
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: SantuColors.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: SantuColors.blue,
      primary: SantuColors.blue,
      surface: SantuColors.card,
    ),
    fontFamily: 'Roboto',
    appBarTheme: const AppBarTheme(
      backgroundColor: SantuColors.card,
      foregroundColor: SantuColors.textDark,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: SantuColors.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: SantuColors.border, width: 1),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 64,
      backgroundColor: SantuColors.card,
      elevation: 2,
      shadowColor: const Color(0x1A000000),
      indicatorColor: SantuColors.blueBg,
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const IconThemeData(color: SantuColors.blue, size: 22);
        }
        return const IconThemeData(color: SantuColors.textMuted, size: 21);
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: SantuColors.blue);
        }
        return const TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: SantuColors.textMuted);
      }),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: SantuColors.card,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: SantuColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: SantuColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: SantuColors.blue, width: 1.5),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: SantuColors.blue,
        foregroundColor: Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
      ),
    ),
  );
}
