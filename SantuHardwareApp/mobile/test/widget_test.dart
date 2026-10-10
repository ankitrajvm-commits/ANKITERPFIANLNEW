// Smoke test: the app boots to the dashboard without throwing.
// The default counter test was for Flutter's starter template, which this
// app no longer is — replaced rather than left pointing at a deleted MyApp.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:santu_hardware_mobile/main.dart';

void main() {
  testWidgets('App boots without throwing', (WidgetTester tester) async {
    await tester.pumpWidget(const SantuHardwareApp());
    await tester.pump();
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
