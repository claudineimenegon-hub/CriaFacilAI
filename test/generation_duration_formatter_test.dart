import 'package:flutter_test/flutter_test.dart';
import 'package:meu_app/features/product_photo/generation_duration_formatter.dart';

void main() {
  test('formata durações abaixo de uma hora como MM:SS', () {
    expect(formatGenerationDuration(Duration.zero), '00:00');
    expect(formatGenerationDuration(const Duration(seconds: 65)), '01:05');
    expect(
      formatGenerationDuration(const Duration(minutes: 59, seconds: 59)),
      '59:59',
    );
  });

  test('formata durações de uma hora ou mais como HH:MM:SS', () {
    expect(formatGenerationDuration(const Duration(hours: 1)), '01:00:00');
    expect(
      formatGenerationDuration(
        const Duration(hours: 12, minutes: 34, seconds: 56),
      ),
      '12:34:56',
    );
  });
}
